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

      {studyingChapter && chapterUe && (
        <TutorModal
          chapterId={studyingChapter.id}
          ueCode={chapterUe.code}
          chapterName={studyingChapter.name}
          onClose={() => setStudyingChapter(null)}
          onCompleted={() => refreshAll()}
        />
      )}
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
