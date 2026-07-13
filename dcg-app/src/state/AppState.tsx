import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { DEFAULT_MODEL } from "../lib/models";
import type { Chapter, DueChapter, QcmScoreRow, SessionLogRow, Ue } from "../lib/types";

interface AppStateValue {
  ready: boolean;
  ues: Ue[];
  chapters: Chapter[];
  qcmScores: QcmScoreRow[];
  timerSessions: SessionLogRow[];
  dueChapters: DueChapter[];
  examDate: string | null;
  model: string;
  refreshAll: () => Promise<void>;
  setExamDate: (iso: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
}

const AppStateCtx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [ues, setUes] = useState<Ue[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [qcmScores, setQcmScores] = useState<QcmScoreRow[]>([]);
  const [timerSessions, setTimerSessions] = useState<SessionLogRow[]>([]);
  const [dueChapters, setDueChapters] = useState<DueChapter[]>([]);
  const [examDate, setExamDateState] = useState<string | null>(null);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);

  const refreshAll = useCallback(async () => {
    const [uesR, chaptersR, qcmR, sessionsR, dueR, examR, modelR] = await Promise.all([
      api.listUes(),
      api.listAllChapters(),
      api.listAllQcmScores(),
      api.listTimerSessions(),
      api.listDueChapters(7),
      api.getMeta("exam_date"),
      api.getMeta("anthropic_model"),
    ]);
    setUes(uesR);
    setChapters(chaptersR);
    setQcmScores(qcmR);
    setTimerSessions(sessionsR);
    setDueChapters(dueR);
    setExamDateState(examR);
    setModelState(modelR || DEFAULT_MODEL);
    setReady(true);
  }, []);

  const setExamDate = useCallback(async (iso: string) => {
    await api.setMeta("exam_date", iso);
    setExamDateState(iso);
  }, []);

  const setModel = useCallback(async (modelId: string) => {
    await api.setMeta("anthropic_model", modelId);
    setModelState(modelId);
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <AppStateCtx.Provider
      value={{ ready, ues, chapters, qcmScores, timerSessions, dueChapters, examDate, model, refreshAll, setExamDate, setModel }}
    >
      {children}
    </AppStateCtx.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateCtx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
