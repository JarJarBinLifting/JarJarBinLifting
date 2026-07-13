use crate::appstate::AppError;
use crate::handlers::settings::read_api_key;
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
}

/// The only place in the whole app that talks to api.anthropic.com. The key
/// is read Rust-side (see handlers::settings::read_api_key) and never crosses
/// into an HTTP response — the frontend only ever calls this endpoint and
/// gets text back.
async fn call_anthropic_inner(system: String, messages: Vec<AnthropicMessage>, max_tokens: Option<u32>, model: Option<String>) -> Result<AnthropicResult, String> {
    let key = read_api_key().ok_or_else(|| "Aucune clé API Anthropic configurée — ajoute-la dans Réglages.".to_string())?;

    let body = serde_json::json!({
        "model": model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        "max_tokens": max_tokens.unwrap_or(4096),
        "system": system,
        "messages": messages,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Échec de la requête vers Anthropic : {e}"))?;

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

    Ok(AnthropicResult { text, input_tokens, output_tokens })
}

pub async fn call_anthropic(Json(body): Json<CallAnthropicRequest>) -> Result<Json<AnthropicResult>, AppError> {
    call_anthropic_inner(body.system, body.messages, body.max_tokens, body.model)
        .await
        .map(Json)
        .map_err(AppError)
}

/// Used by the Settings screen's "test connection" button.
pub async fn test_anthropic_connection() -> Result<Json<bool>, AppError> {
    call_anthropic_inner(
        "Réponds uniquement par OK.".into(),
        vec![AnthropicMessage {
            role: "user".into(),
            content: Value::String("ping".into()),
        }],
        Some(8),
        None,
    )
    .await
    .map(|_| Json(true))
    .map_err(AppError)
}
