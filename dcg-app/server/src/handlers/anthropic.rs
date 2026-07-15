use crate::appstate::{AppError, AppState};
use crate::handlers::settings::read_api_key;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_MODEL: &str = "claude-sonnet-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// `content` is passed through as-is (string or a content-block array for
/// document/image uploads) so the frontend can build Anthropic Messages API
/// payloads without this command needing to understand every content shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: Value,
}

#[derive(Debug, Serialize)]
pub struct AnthropicResult {
    pub text: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallAnthropicRequest {
    pub system: String,
    pub messages: Vec<AnthropicMessage>,
    pub max_tokens: Option<u32>,
    pub model: Option<String>,
    /// Set for multi-turn call sites (Socratic dialogue, exercise-correction
    /// chat) where the same system prompt + growing message history is
    /// resent on every turn. Adds a top-level `cache_control`, which the API
    /// auto-places on the last cacheable block — caching everything before
    /// it (system + prior turns) so each new turn only pays full price for
    /// itself. One-shot calls (story/flashcards/QCM) get no benefit from
    /// this, since there's no second request to read the cache back.
    pub cache: Option<bool>,
}

/// Turns a successful (2xx) Anthropic response body into a result, or a clear
/// French error for the two "technically succeeded but there's nothing
/// usable" shapes: a safety refusal (`stop_reason: "refusal"`, `content`
/// typically empty) and a response truncated by hitting `max_tokens` before
/// finishing its JSON. Both used to fall through as an empty `text`, which
/// the frontend's JSON-parse retry loop burned three attempts on before a
/// generic "Échec après 3 tentatives" — this gives the real reason instead,
/// on the first attempt.
fn parse_response(payload: &Value) -> Result<AnthropicResult, String> {
    let text = payload
        .get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    let input_tokens = payload.get("usage").and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
    let output_tokens = payload.get("usage").and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
    let stop_reason = payload.get("stop_reason").and_then(|v| v.as_str());

    if text.trim().is_empty() && stop_reason == Some("refusal") {
        return Err("Le modèle a refusé de répondre (classificateur de sécurité Anthropic) — reformule le contenu du chapitre ou réessaie.".to_string());
    }
    if text.trim().is_empty() && stop_reason.is_some() {
        return Err(format!("Réponse vide du modèle (raison : {}).", stop_reason.unwrap_or("inconnue")));
    }
    if stop_reason == Some("max_tokens") {
        tracing::warn!("Anthropic response hit max_tokens — likely truncated mid-generation");
    }

    Ok(AnthropicResult { text, input_tokens, output_tokens })
}

/// The only place in the whole app that talks to api.anthropic.com. The key
/// is read Rust-side (see handlers::settings::read_api_key) and never crosses
/// into an HTTP response — the frontend only ever calls this endpoint and
/// gets text back.
async fn call_anthropic_inner(
    http: &reqwest::Client,
    system: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: Option<u32>,
    model: Option<String>,
    cache: bool,
) -> Result<AnthropicResult, String> {
    let key = read_api_key().ok_or_else(|| "Aucune clé API Anthropic configurée — ajoute-la dans Réglages.".to_string())?;

    // `thinking` must be explicitly disabled: on claude-sonnet-5 an omitted
    // `thinking` field runs *adaptive* thinking, and thinking tokens count
    // against `max_tokens`. On a big chapter PDF the model can spend the whole
    // budget thinking and return zero text (`stop_reason: "max_tokens"`,
    // empty `content`) — the "Réponse vide du modèle" failure. Every call in
    // this app is a one-shot strict-JSON generation whose thinking would
    // never be shown anyway, so give the entire budget to the answer.
    let mut body = serde_json::json!({
        "model": model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        "max_tokens": max_tokens.unwrap_or(4096),
        "thinking": {"type": "disabled"},
        "system": system,
        "messages": messages,
    });
    if cache {
        body["cache_control"] = serde_json::json!({"type": "ephemeral"});
    }

    let resp = http
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "La requête vers Anthropic a expiré (délai de 3 minutes dépassé) — réessaie ; si ça persiste, vérifie ta connexion.".to_string()
            } else {
                format!("Échec de la requête vers Anthropic : {e}")
            }
        })?;

    let status = resp.status();
    let payload: Value = resp.json().await.map_err(|e| format!("Réponse Anthropic illisible : {e}"))?;

    if !status.is_success() {
        let msg = payload
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Erreur inconnue de l'API Anthropic");
        return Err(msg.to_string());
    }

    parse_response(&payload)
}

pub async fn call_anthropic(State(state): State<AppState>, Json(body): Json<CallAnthropicRequest>) -> Result<Json<AnthropicResult>, AppError> {
    call_anthropic_inner(&state.http, body.system, body.messages, body.max_tokens, body.model, body.cache.unwrap_or(false))
        .await
        .map(Json)
        .map_err(AppError)
}

/// Used by the Settings screen's "test connection" button.
pub async fn test_anthropic_connection(State(state): State<AppState>) -> Result<Json<bool>, AppError> {
    call_anthropic_inner(
        &state.http,
        "Réponds uniquement par OK.".into(),
        vec![AnthropicMessage {
            role: "user".into(),
            content: Value::String("ping".into()),
        }],
        Some(8),
        None,
        false,
    )
    .await
    .map(|_| Json(true))
    .map_err(AppError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_and_usage_from_a_normal_response() {
        let payload = serde_json::json!({
            "content": [{"type": "text", "text": "hello "}, {"type": "text", "text": "world"}],
            "usage": {"input_tokens": 10, "output_tokens": 2},
            "stop_reason": "end_turn",
        });
        let r = parse_response(&payload).unwrap();
        assert_eq!(r.text, "hello world");
        assert_eq!(r.input_tokens, 10);
        assert_eq!(r.output_tokens, 2);
    }

    #[test]
    fn refusal_with_empty_content_is_a_clear_error_not_empty_text() {
        let payload = serde_json::json!({
            "content": [],
            "usage": {"input_tokens": 5, "output_tokens": 0},
            "stop_reason": "refusal",
        });
        let err = parse_response(&payload).unwrap_err();
        assert!(err.contains("refusé"), "unexpected message: {err}");
    }

    #[test]
    fn empty_content_with_no_recognizable_reason_still_errors_clearly() {
        let payload = serde_json::json!({
            "content": [],
            "usage": {"input_tokens": 5, "output_tokens": 0},
            "stop_reason": "end_turn",
        });
        let err = parse_response(&payload).unwrap_err();
        assert!(err.contains("Réponse vide"), "unexpected message: {err}");
    }

    #[test]
    fn missing_content_field_entirely_does_not_panic() {
        let payload = serde_json::json!({ "usage": {"input_tokens": 1, "output_tokens": 0} });
        // No stop_reason at all in this payload — falls through to Ok with empty text,
        // same as today's behavior for a genuinely malformed/unexpected body shape.
        let r = parse_response(&payload).unwrap();
        assert_eq!(r.text, "");
    }

    #[test]
    fn max_tokens_truncation_still_returns_the_partial_text() {
        let payload = serde_json::json!({
            "content": [{"type": "text", "text": "{\"partial\": tr"}],
            "usage": {"input_tokens": 5, "output_tokens": 16000},
            "stop_reason": "max_tokens",
        });
        let r = parse_response(&payload).unwrap();
        assert_eq!(r.text, "{\"partial\": tr");
    }
}
