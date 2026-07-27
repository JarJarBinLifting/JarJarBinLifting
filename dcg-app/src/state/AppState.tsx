import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { DEFAULT_MODEL } from "../lib/models";
import { DEFAULT_EXAM_DATE } from "../lib/examPlan";
import type { Chapter, DueChapter, DueFlashcardsResponse, DueQuizResponse, ErrorNote, ExamScenarioRow, LessonSummary, QcmScoreRow, SessionLogRow, SkillProfileRow, Ue } from "../lib/types";

interface AppStateValue {
  ready: boolean;
  ues: Ue[];
  chapters: Chapter[];
  qcmScores: QcmScoreRow[];
  timerSessions: SessionLogRow[];
  dueChapters: DueChapter[];
  dueFlashcards: DueFlashcardsResponse;
  dueQuiz: DueQuizResponse;
  errorNotes: ErrorNote[];
  skillProfiles: SkillProfileRow[];
  examScenario: ExamScenarioRow[];
  lessons: LessonSummary[];
  examDate: string | null;
  model: string;
  studentName: string;
  focusUeIds: number[];
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
  const [dueFlashcards, setDueFlashcards] = useState<DueFlashcardsResponse>({ total: 0, cards: [] });
  const [dueQuiz, setDueQuiz] = useState<DueQuizResponse>({ total: 0, items: [] });
  const [errorNotes, setErrorNotes] = useState<ErrorNote[]>([]);
  const [skillProfiles, setSkillProfiles] = useState<SkillProfileRow[]>([]);
  const [examScenario, setExamScenario] = useState<ExamScenarioRow[]>([]);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [examDate, setExamDateState] = useState<string | null>(DEFAULT_EXAM_DATE);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);
  const [studentName, setStudentName] = useState("");
  const [focusUeIds, setFocusUeIds] = useState<number[]>([]);

  const refreshAll = useCallback(async () => {
    const [uesR, chaptersR, qcmR, sessionsR, dueR, dueCardsR, dueQuizR, errorsR, skillsR, scenarioR, lessonsR, examR, modelR, nameR, focusR] = await Promise.all([
      api.listUes(),
      api.listAllChapters(),
      api.listAllQcmScores(),
      api.listTimerSessions(),
      api.listDueChapters(7),
      api.listDueFlashcards(),
      api.listDueQuiz(),
      api.listErrorNotes(),
      api.listSkillProfiles(),
      api.listExamScenario(),
      api.listActiveLessons(),
      api.getMeta("exam_date"),
      api.getMeta("anthropic_model"),
      api.getMeta("student_name"),
      api.getMeta("focus_ue_ids"),
    ]);
    setUes(uesR);
    setChapters(chaptersR);
    setQcmScores(qcmR);
    setTimerSessions(sessionsR);
    setDueChapters(dueR);
    setDueFlashcards(dueCardsR);
    setDueQuiz(dueQuizR);
    setErrorNotes(errorsR);
    setSkillProfiles(skillsR);
    setExamScenario(scenarioR);
    setLessons(lessonsR);
    const resolvedExamDate = examR || DEFAULT_EXAM_DATE;
    setExamDateState(resolvedExamDate);
    if (!examR) void api.setMeta("exam_date", resolvedExamDate);
    setModelState(modelR || DEFAULT_MODEL);
    setStudentName(nameR || "");
    try { setFocusUeIds(focusR ? JSON.parse(focusR) : []); } catch { setFocusUeIds([]); }
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
      value={{ ready, ues, chapters, qcmScores, timerSessions, dueChapters, dueFlashcards, dueQuiz, errorNotes, skillProfiles, examScenario, lessons, examDate, model, studentName, focusUeIds, refreshAll, setExamDate, setModel }}
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
