import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { BackupInfo, LocalConfig } from "../../lib/types";
import { useAppState } from "../../state/AppState";

export function SettingsScreen() {
  const [config, setConfig] = useState<LocalConfig | null>(null);

  const refresh = () => {
    api.getLocalConfig().then(setConfig);
  };

  useEffect(refresh, []);

  return (
    <div className="desktop-page narrow settings-page">
      <div className="work-header" style={{ marginBottom: 24 }}><div><div className="eyebrow">Configuration personnelle</div><div className="work-title" style={{ fontSize: 34 }}>Réglages</div><div className="work-lead">Tout reste sur cette machine : tes données, tes leçons importées et tes sauvegardes.</div></div></div>

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

      <ProfileSection />
      <ExamDateSection />
    </div>
  );
}

function ProfileSection() {
  const { studentName, focusUeIds, ues, refreshAll } = useAppState();
  const [name, setName] = useState(studentName);
  const [focus, setFocus] = useState<number[]>(focusUeIds);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setName(studentName); setFocus(focusUeIds); }, [studentName, focusUeIds]);
  const save = async () => {
    await Promise.all([api.setMeta("student_name", name.trim()), api.setMeta("focus_ue_ids", JSON.stringify(focus))]);
    await refreshAll(); setSaved(true); window.setTimeout(() => setSaved(false), 2000);
  };
  return <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 16 }}>
    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Parcours personnel</div>
    <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>Le plan quotidien cherche d'abord le prochain chapitre dans tes UE prioritaires.</p>
    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Prénom" style={{ width: "100%", padding: "10px 12px", marginBottom: 9, color: "var(--text)", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 6 }} />
    <div className="settings-focus-ues">{ues.map((ue) => <label key={ue.id} className={focus.includes(ue.id) ? "selected" : ""}><input type="checkbox" checked={focus.includes(ue.id)} onChange={() => setFocus((current) => current.includes(ue.id) ? current.filter((id) => id !== ue.id) : [...current, ue.id])} />{ue.code}</label>)}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12 }}><button className="primary-button" disabled={!name.trim() || !focus.length} onClick={save}>Enregistrer</button>{saved && <span style={{ color: "var(--accent-green)", fontSize: 11 }}>Parcours mis à jour</span>}<button className="text-action" style={{ marginLeft: "auto" }} onClick={async () => { await api.setMeta("onboarding_complete", "0"); window.location.reload(); }}>Relancer l'accueil guidé</button></div>
  </section>;
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

function ExamDateSection() {
  const { examDate, setExamDate } = useAppState();
  const [draft, setDraft] = useState(examDate ?? "");

  return (
    <section className="settings-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Date d'examen</div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>Le prochain examen est fixé au 30 mai 2027. Cette date pilote les phases de couverture, consolidation, annales et révision finale.</p>
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
