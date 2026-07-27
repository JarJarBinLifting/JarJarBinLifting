import { useEffect, useState } from "react";
import * as api from "./lib/api";
import { ThemeProvider } from "./lib/theme";
import { AppStateProvider, useAppState } from "./state/AppState";
import { Nav, type ShellView } from "./components/shell/Nav";
import { Dashboard } from "./components/shell/Dashboard";
import { UEDetail } from "./components/shell/UEDetail";
import { Pilotage } from "./components/shell/Pilotage";
import { Timer } from "./components/shell/Timer";
import { Programme } from "./components/shell/Programme";
import { Annales } from "./components/shell/Annales";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { TutorModal } from "./components/tutor/TutorModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Chapter, Ue } from "./lib/types";
import { Onboarding } from "./components/Onboarding";

function MainApp() {
  const { ues, refreshAll } = useAppState();
  const [view, setView] = useState<ShellView>("dash");
  const [selectedUe, setSelectedUe] = useState<Ue | null>(null);
  const [studyingChapter, setStudyingChapter] = useState<Chapter | null>(null);

  const openUe = (ue: Ue) => {
    setSelectedUe(ue);
    setView("ue");
  };

  const navigate = (v: ShellView) => {
    if (v !== "ue") setSelectedUe(null);
    setView(v);
  };

  const chapterUe = studyingChapter ? ues.find((u) => u.id === studyingChapter.ue_id) : null;

  return (
    <div className="app-shell">
      <Nav view={view} onNavigate={navigate} />
      <main className="app-main">
        {view === "dash" && <Dashboard onNavigate={navigate} onQuickStart={(c) => setStudyingChapter(c)} />}
        {view === "ue" && selectedUe && (
          <UEDetail ue={selectedUe} onBack={() => navigate("dash")} onStudyChapter={(c) => setStudyingChapter(c)} />
        )}
        {view === "programme" && <Programme onOpenUe={openUe} />}
        {view === "progress" && <Pilotage />}
        {view === "annales" && <Annales />}
        {view === "timer" && <Timer />}
        {view === "settings" && <SettingsScreen />}
      </main>

      <ErrorBoundary
        onReset={() => {
          setStudyingChapter(null);
          refreshAll();
        }}
        fallback={(error, reset) => (
          <div className="tutor-modal" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="tutor-card" style={{ maxWidth: 420, textAlign: "center" }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  margin: "0 auto 14px",
                  border: "1.5px solid var(--t-err)",
                  color: "var(--t-err)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontSize: 18,
                }}
              >
                !
              </div>
              <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-err)", marginBottom: 8 }}>
                La session a rencontré une erreur
              </h3>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
                Ta progression jusqu'à la dernière étape terminée est enregistrée — rien n'est perdu. Ferme la session pour
                revenir au planning ; la prochaine fois, tu pourras reprendre où tu t'es arrêté.
              </p>
              <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", marginBottom: 16, wordBreak: "break-word" }}>
                {error.message}
              </p>
              <button className="tutor-bp" style={{ width: "100%" }} onClick={reset}>
                Fermer et revenir au planning
              </button>
            </div>
          </div>
        )}
      >
        {studyingChapter && chapterUe && (
          <TutorModal
            chapterId={studyingChapter.id}
            ueCode={chapterUe.code}
            chapterName={studyingChapter.name}
            onClose={() => setStudyingChapter(null)}
            onCompleted={() => refreshAll()}
          />
        )}
      </ErrorBoundary>
      <Onboarding />
    </div>
  );
}

export default function App() {
  // Single-machine app: the database is auto-provisioned at a default
  // location by the Rust setup() hook before the window even opens, so this
  // should resolve to `true` almost instantly. The `false` branch only shows
  // up if that auto-provisioning genuinely failed (e.g. a permissions issue
  // on the app-data directory) — a rare recovery path, not the normal flow.
  const [dbConfigured, setDbConfigured] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    api.getLocalConfig().then((cfg) => setDbConfigured(cfg.db_open));
  }, []);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.ensureDefaultDb();
      const cfg = await api.getLocalConfig();
      setDbConfigured(cfg.db_open);
    } catch (e) {
      setRetryError(String(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ThemeProvider>
      {dbConfigured === null && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Chargement…</div>}
      {dbConfigured === false && (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 380, textAlign: "center" }}>
            <div
              style={{
                width: 34,
                height: 34,
                margin: "0 auto 14px",
                border: "1.5px solid var(--accent-red)",
                color: "var(--accent-red)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              !
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
              Impossible de préparer la base de données
            </h1>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
              L'application n'a pas pu créer son fichier de données au démarrage. Vérifie que le dossier de données de
              l'application est accessible, puis réessaie.
            </p>
            {retryError && <p style={{ fontSize: 11, color: "var(--accent-red)", fontFamily: "monospace", marginBottom: 16 }}>{retryError}</p>}
            <button
              disabled={retrying}
              onClick={retry}
              style={{ padding: "10px 20px", background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, fontSize: 14, fontWeight: 600 }}
            >
              {retrying ? "Nouvelle tentative…" : "Réessayer"}
            </button>
          </div>
        </div>
      )}
      {dbConfigured === true && (
        <AppStateProvider>
          <MainApp />
        </AppStateProvider>
      )}
    </ThemeProvider>
  );
}
