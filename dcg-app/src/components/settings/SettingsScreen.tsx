import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { MODEL_OPTIONS } from "../../lib/models";
import { formatTokens } from "../../lib/format";
import type { ApiKeyStatus, LocalConfig, ModelUsageRow } from "../../lib/types";
import { useAppState } from "../../state/AppState";

const STORAGE_LABEL: Record<ApiKeyStatus["storage"], string> = {
  keychain: "trousseau du système (recommandé)",
  plaintext_fallback: "fichier local non chiffré (aucun trousseau système détecté)",
  none: "aucune clé enregistrée",
};

export function SettingsScreen() {
  const [config, setConfig] = useState<LocalConfig | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [testing, setTesting] = useState<"idle" | "ok" | "fail" | "running">("idle");

  const refresh = () => {
    api.getLocalConfig().then(setConfig);
    api.getApiKeyStatus().then(setKeyStatus);
  };

  useEffect(refresh, []);

  return (
    <div className="desktop-page narrow settings-page">
      <div className="work-header" style={{ marginBottom: 24 }}><div><div className="eyebrow">Configuration personnelle</div><div className="work-title" style={{ fontSize: 34 }}>Réglages</div><div className="work-lead">Tout reste sur cette machine : tes données, tes préférences et ta clé de travail.</div></div></div>

      <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Tes données</div>
        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
          Tout est stocké localement dans un seul fichier SQLite, créé automatiquement au premier lancement.
        </p>
        {config?.db_path && (
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted)", background: "var(--card2)", padding: "8px 10px", borderRadius: 2, marginBottom: 12, wordBreak: "break-all" }}>
            {config.db_path}
          </div>
        )}
        <ExportButton />
      </section>

      <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Clé API Anthropic</div>
        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
          Le tuteur IA a besoin d'une clé API Anthropic (console.anthropic.com), facturée à l'usage — ce n'est pas ton
          abonnement claude.ai, qui ne peut pas être connecté à une application tierce.
        </p>
        {keyStatus && (
          <div
            style={{
              fontSize: 12,
              color: !keyStatus.has_key
                ? "var(--muted)"
                : keyStatus.storage === "plaintext_fallback"
                  ? "var(--accent-yellow)"
                  : "var(--accent-green)",
              marginBottom: 10,
            }}
          >
            {keyStatus.has_key ? `Clé enregistrée — ${STORAGE_LABEL[keyStatus.storage]}` : "Aucune clé enregistrée."}
          </div>
        )}
        {keyStatus?.storage === "plaintext_fallback" && (
          <div
            style={{
              fontSize: 11,
              color: "var(--accent-yellow)",
              lineHeight: 1.6,
              marginBottom: 12,
              padding: "8px 10px",
              border: "1px solid var(--accent-yellow)",
              borderRadius: 2,
            }}
          >
            Aucun trousseau système n'a été détecté : ta clé est enregistrée en clair dans un fichier local
            (non synchronisé). Elle reste sur cette machine, mais n'est pas chiffrée sur disque.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-…"
            style={{ flex: 1, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "10px 14px", color: "var(--text)", fontSize: 13 }}
          />
          <button
            disabled={!keyInput.trim()}
            onClick={async () => {
              const status = await api.saveApiKey(keyInput.trim());
              setKeyStatus(status);
              setKeyInput("");
              setTesting("idle");
            }}
            style={{ padding: "10px 16px", background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, fontSize: 13, fontWeight: 600 }}
          >
            Enregistrer
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            disabled={!keyStatus?.has_key || testing === "running"}
            onClick={async () => {
              setTesting("running");
              try {
                await api.testAnthropicConnection();
                setTesting("ok");
              } catch {
                setTesting("fail");
              }
            }}
            style={{ padding: "8px 14px", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, fontSize: 12, color: "var(--text)" }}
          >
            {testing === "running" ? "Test en cours…" : "Tester la connexion"}
          </button>
          {testing === "ok" && <span style={{ fontSize: 12, color: "var(--accent-green)" }}>Connexion OK</span>}
          {testing === "fail" && <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Échec — vérifie la clé</span>}
          {keyStatus?.has_key && (
            <button
              onClick={async () => {
                await api.clearApiKey();
                refresh();
              }}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--accent-red)", fontSize: 12 }}
            >
              Supprimer la clé
            </button>
          )}
        </div>
      </section>

      <ModelSection />
      <UsageSection />
      <ExamDateSection />
    </div>
  );
}

function ExportButton() {
  const [result, setResult] = useState<"idle" | "ok">("idle");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        onClick={() => {
          // The server streams the backup with a Content-Disposition header,
          // so a plain anchor click triggers the browser's native download —
          // no save-dialog needed, and it works the same in dev and prod.
          const a = document.createElement("a");
          a.href = api.exportDatabaseUrl;
          a.click();
          setResult("ok");
        }}
        style={{ padding: "10px 16px", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, fontSize: 13, fontWeight: 600, color: "var(--text)" }}
      >
        Exporter une sauvegarde…
      </button>
      {result === "ok" && <span style={{ fontSize: 12, color: "var(--accent-green)" }}>Téléchargement lancé</span>}
    </div>
  );
}

const MODEL_LABEL: Record<string, string> = Object.fromEntries(MODEL_OPTIONS.map((m) => [m.id, m.label]));

function UsageSection() {
  const [rows, setRows] = useState<ModelUsageRow[] | null>(null);

  useEffect(() => {
    api.getUsageSummary().then(setRows);
  }, []);

  const total = (rows ?? []).reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);

  return (
    <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Utilisation</div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
        Jetons consommés par le tuteur, cumulés depuis le début — directement depuis les réponses de l'API, donc exacts.
        Pour convertir en coût réel, consulte les tarifs actuels sur console.anthropic.com/settings/pricing (ils changent
        avec le temps, mieux vaut vérifier là-bas qu'ici).
      </p>
      {!rows ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Aucune session terminée pour l'instant.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {rows.map((r) => (
              <div key={r.model} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--card2)", borderRadius: 2, fontSize: 12 }}>
                <span style={{ flex: 1, fontWeight: 600, color: "var(--text)" }}>{MODEL_LABEL[r.model] ?? r.model}</span>
                <span style={{ color: "var(--muted)" }}>{r.session_count} session{r.session_count > 1 ? "s" : ""}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                  ↓{formatTokens(r.input_tokens)} ↑{formatTokens(r.output_tokens)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Total : {formatTokens(total)} jetons</div>
        </>
      )}
    </section>
  );
}

function ModelSection() {
  const { model, setModel } = useAppState();
  const [saving, setSaving] = useState(false);

  return (
    <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Modèle du tuteur</div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
        Une session complète déclenche une dizaine d'appels au modèle (histoire, feedback, flashcards, QCM, dialogue,
        correction…) — le choix du modèle a un vrai impact sur le coût et la vitesse d'une session, pas seulement par appel.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MODEL_OPTIONS.map((m) => (
          <label
            key={m.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 2,
              border: `1px solid ${model === m.id ? "var(--accent-blue)" : "var(--border)"}`,
              background: model === m.id ? "color-mix(in srgb, var(--accent-blue) 10%, var(--card))" : "transparent",
              cursor: saving ? "default" : "pointer",
            }}
          >
            <input
              type="radio"
              name="model"
              checked={model === m.id}
              disabled={saving}
              onChange={async () => {
                setSaving(true);
                await setModel(m.id);
                setSaving(false);
              }}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{m.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{m.note}</div>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

function ExamDateSection() {
  const { examDate, setExamDate } = useAppState();
  const [draft, setDraft] = useState(examDate ?? "");

  return (
    <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Date d'examen</div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>Affiche un compte à rebours sur le tableau de bord.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "10px 14px", color: "var(--text)", fontSize: 14 }}
        />
        <button
          disabled={!draft}
          onClick={() => setExamDate(draft)}
          style={{ padding: "10px 16px", background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, fontSize: 13, fontWeight: 600 }}
        >
          Enregistrer
        </button>
      </div>
    </section>
  );
}
