import { useEffect, useState } from "react";
import * as api from "./lib/api";
import { ThemeProvider } from "./lib/theme";
import { AppStateProvider, useAppState } from "./state/AppState";
import { Nav, type ShellView } from "./components/shell/Nav";
import { Dashboard } from "./components/shell/Dashboard";
import { UEDetail } from "./components/shell/UEDetail";
import { Agenda } from "./components/shell/Agenda";
import { Timer } from "./components/shell/Timer";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { TutorModal } from "./components/tutor/TutorModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Chapter, Ue } from "./lib/types";

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
    <div style={{ minHeight: "100vh" }}>
      <div style={{ paddingBottom: 72 }}>
        {view === "dash" && <Dashboard onOpenUe={openUe} onNavigate={navigate} />}
        {view === "ue" && selectedUe && (
          <UEDetail ue={selectedUe} onBack={() => navigate("dash")} onStudyChapter={(c) => setStudyingChapter(c)} />
        )}
        {view === "agenda" && <Agenda onStudyChapter={(c) => setStudyingChapter(c)} />}
        {view === "timer" && <Timer />}
        {view === "settings" && <SettingsScreen />}
      </div>
      <Nav view={view} onNavigate={navigate} />

      <ErrorBoundary
        onReset={() => {
          setStudyingChapter(null);
          refreshAll();
        }}
        fallback={(error, reset) => (
          <div className="tutor-modal" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="tutor-card" style={{ maxWidth: 420, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
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
    </div>
  );
}

export default function App() {
  const [dbConfigured, setDbConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    api.getLocalConfig().then((cfg) => setDbConfigured(!!cfg.db_path));
  }, []);

  return (
    <ThemeProvider>
      {dbConfigured === null && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Chargement…</div>}
      {dbConfigured === false && <SettingsScreen onboarding onDbReady={() => setDbConfigured(true)} />}
      {dbConfigured === true && (
        <AppStateProvider>
          <MainApp />
        </AppStateProvider>
      )}
    </ThemeProvider>
  );
}
