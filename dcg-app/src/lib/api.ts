import type {
  ApiKeyStatus,
  Chapter,
  CompleteTutorSessionResult,
  AnnaleAttempt,
  BackupInfo,
  DueChapter,
  DueFlashcardsResponse,
  DueQuizResponse,
  QuizAnswerResult,
  WeeklyBilan,
  ErrorNote,
  ErrorSource,
  ErrorType,
  ExamScenarioRow,
  FlashcardRow,
  LocalConfig,
  ModelUsageRow,
  QcmScoreRow,
  SessionLogRow,
  SkillProfileRow,
  TutorSessionRow,
  Ue,
  WeakChapter,
  ExamSkill,
} from "./types";

/// Every route this app talks to is same-origin (`/api/...`), served by the
/// local Rust server — in dev, Vite proxies `/api` to it (see vite.config.ts).
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch() only rejects on network-level failures — for a localhost app
    // that means the server process is gone (console window closed?) or it
    // reset the connection. Say that, instead of the browser's opaque
    // "Failed to fetch".
    throw new Error("Connexion au serveur local impossible — vérifie que DCG Étude (la fenêtre noire) est toujours ouvert, puis recharge la page.");
  }

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // non-JSON error body — fall back to statusText
    }
    throw new Error(message);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {});
const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {});
const del = <T>(path: string) => request<T>("DELETE", path);

// ─── Settings ───

export const getLocalConfig = () => get<LocalConfig>("/settings/local-config");
export const setDbPath = (path: string) => post<void>("/settings/db-path", { path });
export const ensureDefaultDb = () => post<void>("/settings/ensure-default-db");

export const saveApiKey = (key: string) => post<ApiKeyStatus>("/settings/api-key", { key });
export const getApiKeyStatus = () => get<ApiKeyStatus>("/settings/api-key/status");
export const clearApiKey = () => del<void>("/settings/api-key");

/// Not a fetch — the export route streams a file with a
/// `Content-Disposition: attachment` header, so the browser handles the
/// download natively when navigated to directly (see SettingsScreen).
export const exportDatabaseUrl = "/api/settings/export";

// ─── Anthropic ───

export interface AnthropicMessageInput {
  role: "user" | "assistant";
  content: unknown; // string or Anthropic content-block array (documents/images)
}

export interface AnthropicCallResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

export const callAnthropic = (
  system: string,
  messages: AnthropicMessageInput[],
  maxTokens = 4096,
  model?: string,
  cache = false,
) => post<AnthropicCallResult>("/anthropic/call", { system, messages, maxTokens, model, cache });

export const testAnthropicConnection = () => post<boolean>("/anthropic/test");

// ─── Planner ───

export const seedDefaultCurriculum = () => post<boolean>("/planner/seed");
export const listUes = () => get<Ue[]>("/planner/ues");
export const updateUeNotes = (
  ueId: number,
  pointsForts: string | null,
  pointsFaibles: string | null,
  notes: string | null,
) =>
  patch<void>(`/planner/ues/${ueId}/notes`, {
    points_forts: pointsForts,
    points_faibles: pointsFaibles,
    notes,
  });

export const listChapters = (ueId: number) => get<Chapter[]>(`/planner/ues/${ueId}/chapters`);
export const listAllChapters = () => get<Chapter[]>("/planner/chapters");
export const cycleChapterStatus = (chapterId: number) =>
  post<Chapter>(`/planner/chapters/${chapterId}/cycle-status`);

export const listQcmScores = (chapterId: number) => get<QcmScoreRow[]>(`/planner/chapters/${chapterId}/qcm-scores`);
export const listAllQcmScores = () => get<QcmScoreRow[]>("/planner/qcm-scores");
export const addQcmScore = (chapterId: number, date: string, score: number, total: number) =>
  post<QcmScoreRow>("/planner/qcm-scores", { chapter_id: chapterId, date, score, total });
export const deleteQcmScore = (id: number) => del<void>(`/planner/qcm-scores/${id}`);

export const listTimerSessions = () => get<SessionLogRow[]>("/planner/sessions");
export const addTimerSession = (
  ueId: number | null,
  chapterId: number | null,
  preset: string | null,
  durationSeconds: number,
  startedAt: string,
  endedAt: string,
) =>
  post<SessionLogRow>("/planner/sessions", {
    ue_id: ueId,
    chapter_id: chapterId,
    preset,
    duration_seconds: durationSeconds,
    started_at: startedAt,
    ended_at: endedAt,
  });
export const deleteTimerSession = (id: number) => del<void>(`/planner/sessions/${id}`);

// ─── Exam pilotage ───

export const listErrorNotes = () => get<ErrorNote[]>("/planner/errors");
export const createErrorNote = (input: {
  ue_id: number;
  chapter_id: number | null;
  title: string;
  error_type: ErrorType;
  skill: ExamSkill;
  my_reasoning?: string | null;
  correction?: string | null;
  source?: ErrorSource;
}) => post<ErrorNote>("/planner/errors", input);
export const advanceErrorNote = (id: number) => post<ErrorNote>(`/planner/errors/${id}/advance`);
export const deleteErrorNote = (id: number) => del<void>(`/planner/errors/${id}`);

export const listSkillProfiles = () => get<SkillProfileRow[]>("/planner/skills");
export const recordSkillAssessment = (input: {
  ue_id: number;
  chapter_id?: number | null;
  skill: ExamSkill;
  score: number;
  note?: string | null;
}) => post<void>("/planner/skills", input);

export const listExamScenario = () => get<ExamScenarioRow[]>("/planner/exam-scenario");
export const setExamScenario = (ueId: number, currentMark: number | null, targetMark: number | null) =>
  put<void>(`/planner/exam-scenario/${ueId}`, { current_mark: currentMark, target_mark: targetMark });

export const getMeta = (key: string) => get<string | null>(`/planner/meta/${key}`);
export const setMeta = (key: string, value: string) => put<void>(`/planner/meta/${key}`, { value });

// ─── Tutor ───

export const startOrResumeTutorSession = (
  chapterId: number,
  inputSourceType: "paste" | "pdf" | "image" | null,
  adhdMode: boolean,
  difficulty: string,
  model: string,
  isRevision: boolean,
) =>
  post<TutorSessionRow>("/tutor/sessions/start", {
    chapter_id: chapterId,
    input_source_type: inputSourceType,
    adhd_mode: adhdMode,
    difficulty,
    model,
    is_revision: isRevision,
  });

export const getLatestCompletedSession = (chapterId: number) =>
  get<TutorSessionRow | null>(`/tutor/chapters/${chapterId}/latest-completed`);

export const getInProgressSession = (chapterId: number) =>
  get<TutorSessionRow | null>(`/tutor/chapters/${chapterId}/in-progress`);

export interface TutorSessionPatch {
  story_json?: string | null;
  concepts_json?: string | null;
  confidence_json?: string | null;
  qcm_json?: string | null;
  qcm_results_json?: string | null;
  qcm_score?: number | null;
  qcm_total?: number | null;
  socratique_transcript_json?: string | null;
  exercice_json?: string | null;
  bilan_json?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export const saveTutorSessionProgress = (id: number, sessionPatch: TutorSessionPatch) =>
  patch<TutorSessionRow>(`/tutor/sessions/${id}`, sessionPatch);

export const abandonTutorSession = (id: number) => post<void>(`/tutor/sessions/${id}/abandon`);

export const listFlashcards = (chapterId: number) => get<FlashcardRow[]>(`/tutor/chapters/${chapterId}/flashcards`);
export const saveFlashcards = (
  chapterId: number,
  tutorSessionId: number,
  cards: { concept_id: string | null; question: string; answer: string }[],
) => post<FlashcardRow[]>(`/tutor/chapters/${chapterId}/flashcards`, { tutor_session_id: tutorSessionId, cards });
export const updateFlashcardProgress = (id: number, correct: boolean) =>
  post<FlashcardRow>(`/tutor/flashcards/${id}/progress`, { correct });
export const listDueFlashcards = () => get<DueFlashcardsResponse>("/tutor/flashcards/due");

// ─── quiz éclair ───
export const listDueQuiz = () => get<DueQuizResponse>("/tutor/quiz/due");
export const answerQuizItem = (id: number, choice: number) => post<QuizAnswerResult>(`/tutor/quiz/${id}/answer`, { choice });

// ─── annale training ───
export const listAnnales = () => get<AnnaleAttempt[]>("/annales");
export const startAnnale = (body: {
  ue_id: number;
  chapter_id: number | null;
  title: string;
  subject_text: string;
  corrige_text: string | null;
  duration_minutes: number;
}) => post<AnnaleAttempt>("/annales", body);
export const patchAnnale = (id: number, body: { exercice_json?: string; answers_json?: string }) =>
  patch<AnnaleAttempt>(`/annales/${id}`, body);
export const completeAnnale = (id: number, correctionJson: string, elapsedSeconds: number) =>
  post<AnnaleAttempt>(`/annales/${id}/complete`, { correction_json: correctionJson, elapsed_seconds: elapsedSeconds });
export const abandonAnnale = (id: number) => post<void>(`/annales/${id}/abandon`);
export const deleteAnnale = (id: number) => del<void>(`/annales/${id}`);

// ─── bilan hebdomadaire ───
export const getWeeklyBilan = () => get<WeeklyBilan>("/planner/weekly-bilan");

// ─── backups ───
export const listBackups = () => get<BackupInfo[]>("/settings/backups");
export const backupNow = () => post<BackupInfo[]>("/settings/backups");
export const restoreBackup = (fileName: string) => post<void>("/settings/backups/restore", { file_name: fileName });
/** Raw-body upload: the file IS the request body (a SQLite database). */
export async function restoreUpload(file: File): Promise<void> {
  const res = await fetch("/api/settings/backups/restore-upload", { method: "POST", body: file });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
}

export const completeTutorSession = (
  tutorSessionId: number,
  avgConfidence: number,
  overconfidenceCount: number,
) =>
  post<CompleteTutorSessionResult>(`/tutor/sessions/${tutorSessionId}/complete`, {
    avg_confidence: avgConfidence,
    overconfidence_count: overconfidenceCount,
  });

export const listDueChapters = (withinDays: number) =>
  get<DueChapter[]>(`/tutor/due-chapters?within_days=${withinDays}`);

export const listWeakChapters = () => get<WeakChapter[]>("/tutor/weak-chapters");

export const getUsageSummary = () => get<ModelUsageRow[]>("/tutor/usage");
