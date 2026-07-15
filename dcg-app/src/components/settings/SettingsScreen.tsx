import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { MODEL_OPTIONS } from "../../lib/models";
import { formatTokens } from "../../lib/format";
import type { ApiKeyStatus, BackupInfo, LocalConfig, ModelUsageRow } from "../../lib/types";
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

      <BackupsSection />

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

function BackupsSection() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = () => api.listBackups().then(setBackups).catch(() => setBackups([]));
  useEffect(() => {
    refresh();
  }, []);

  const fmtSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`);

  const runNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setBackups(await api.backupNow());
      setMessage({ kind: "ok", text: "Sauvegarde créée." });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (fileName: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.restoreBackup(fileName);
      // Everything in memory now describes the old database — reload from scratch.
      window.location.reload();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
      setConfirming(null);
    }
  };

  const restoreFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.restoreUpload(file);
      window.location.reload();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Sauvegardes automatiques</div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
        Une copie de la base est prise automatiquement au premier lancement de chaque jour (les 7 dernières sont
        conservées). Restaurer remplace la base actuelle — une copie de sécurité de l'état actuel est prise juste avant,
        donc l'opération est réversible.
      </p>
      {message && (
        <div style={{ fontSize: 12, color: message.kind === "ok" ? "var(--accent-green)" : "var(--accent-red)", marginBottom: 10 }}>{message.text}</div>
      )}
      {backups === null ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Chargement…</p>
      ) : backups.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Aucune sauvegarde pour l'instant — la première sera prise au prochain lancement.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {backups.map((b) => (
            <div key={b.file_name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--card2)", borderRadius: 2, fontSize: 12 }}>
              <span style={{ flex: 1, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {b.created_label}
                {b.is_safety && <span style={{ color: "var(--accent-yellow)", marginLeft: 8 }}>copie pré-restauration</span>}
              </span>
              <span style={{ color: "var(--muted)", flexShrink: 0 }}>{fmtSize(b.size_bytes)}</span>
              {confirming === b.file_name ? (
                <>
                  <button disabled={busy} onClick={() => restore(b.file_name)} style={{ background: "var(--accent-red)", color: "#fff", border: "none", borderRadius: 2, padding: "6px 10px", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                    {busy ? "Restauration…" : "Confirmer"}
                  </button>
                  <button disabled={busy} onClick={() => setConfirming(null)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                    Annuler
                  </button>
                </>
              ) : (
                <button disabled={busy} onClick={() => setConfirming(b.file_name)} style={{ background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "6px 10px", fontSize: 11, color: "var(--text)", fontWeight: 700, flexShrink: 0 }}>
                  Restaurer
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={runNow} style={{ padding: "9px 14px", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          Sauvegarder maintenant
        </button>
        <label style={{ padding: "9px 14px", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, fontSize: 12, fontWeight: 700, color: "var(--text)", cursor: busy ? "default" : "pointer" }}>
          Restaurer depuis un fichier…
          <input
            type="file"
            accept=".sqlite3,.sqlite,.db"
            disabled={busy}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) restoreFile(file);
            }}
          />
        </label>
      </div>
    </section>
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
