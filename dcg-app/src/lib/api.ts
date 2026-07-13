import { invoke } from "@tauri-apps/api/core";
import type {
  ApiKeyStatus,
  Chapter,
  CompleteTutorSessionResult,
  DueChapter,
  FlashcardRow,
  LocalConfig,
  ModelUsageRow,
  QcmScoreRow,
  SessionLogRow,
  TutorSessionRow,
  Ue,
} from "./types";

// ─── Settings ───

export const getLocalConfig = () => invoke<LocalConfig>("get_local_config");
export const setDbPath = (path: string) => invoke<void>("set_db_path", { path });
export const reopenConfiguredDb = () => invoke<boolean>("reopen_configured_db");
export const ensureDefaultDb = () => invoke<void>("ensure_default_db");

export const saveApiKey = (key: string) => invoke<ApiKeyStatus>("save_api_key", { key });
export const getApiKeyStatus = () => invoke<ApiKeyStatus>("get_api_key_status");
export const clearApiKey = () => invoke<void>("clear_api_key");
export const exportDatabase = (destination: string) => invoke<void>("export_database", { destination });

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
) => invoke<AnthropicCallResult>("call_anthropic", { system, messages, maxTokens, model });

export const testAnthropicConnection = () => invoke<boolean>("test_anthropic_connection");

// ─── Planner ───

export const seedDefaultCurriculum = () => invoke<boolean>("seed_default_curriculum");
export const listUes = () => invoke<Ue[]>("list_ues");
export const updateUeNotes = (
  ueId: number,
  pointsForts: string | null,
  pointsFaibles: string | null,
  notes: string | null,
) => invoke<void>("update_ue_notes", { ueId, pointsForts, pointsFaibles, notes });

export const listChapters = (ueId: number) => invoke<Chapter[]>("list_chapters", { ueId });
export const listAllChapters = () => invoke<Chapter[]>("list_all_chapters");
export const cycleChapterStatus = (chapterId: number) =>
  invoke<Chapter>("cycle_chapter_status", { chapterId });

export const listQcmScores = (chapterId: number) => invoke<QcmScoreRow[]>("list_qcm_scores", { chapterId });
export const listAllQcmScores = () => invoke<QcmScoreRow[]>("list_all_qcm_scores");
export const addQcmScore = (chapterId: number, date: string, score: number, total: number) =>
  invoke<QcmScoreRow>("add_qcm_score", { chapterId, date, score, total });
export const deleteQcmScore = (id: number) => invoke<void>("delete_qcm_score", { id });

export const listTimerSessions = () => invoke<SessionLogRow[]>("list_timer_sessions");
export const addTimerSession = (
  ueId: number | null,
  chapterId: number | null,
  preset: string | null,
  durationSeconds: number,
  startedAt: string,
  endedAt: string,
) =>
  invoke<SessionLogRow>("add_timer_session", {
    ueId,
    chapterId,
    preset,
    durationSeconds,
    startedAt,
    endedAt,
  });
export const deleteTimerSession = (id: number) => invoke<void>("delete_timer_session", { id });

export const getMeta = (key: string) => invoke<string | null>("get_meta", { key });
export const setMeta = (key: string, value: string) => invoke<void>("set_meta", { key, value });

// ─── Tutor ───

export const startOrResumeTutorSession = (
  chapterId: number,
  inputSourceType: "paste" | "pdf" | "image" | null,
  adhdMode: boolean,
  difficulty: string,
  model: string,
  isRevision: boolean,
) =>
  invoke<TutorSessionRow>("start_or_resume_tutor_session", {
    chapterId,
    inputSourceType,
    adhdMode,
    difficulty,
    model,
    isRevision,
  });

export const getLatestCompletedSession = (chapterId: number) =>
  invoke<TutorSessionRow | null>("get_latest_completed_session", { chapterId });

export const getInProgressSession = (chapterId: number) =>
  invoke<TutorSessionRow | null>("get_in_progress_session", { chapterId });

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

export const saveTutorSessionProgress = (id: number, patch: TutorSessionPatch) =>
  invoke<TutorSessionRow>("save_tutor_session_progress", { id, patch });

export const abandonTutorSession = (id: number) => invoke<void>("abandon_tutor_session", { id });

export const listFlashcards = (chapterId: number) => invoke<FlashcardRow[]>("list_flashcards", { chapterId });
export const saveFlashcards = (
  chapterId: number,
  tutorSessionId: number,
  cards: { concept_id: string | null; question: string; answer: string }[],
) => invoke<FlashcardRow[]>("save_flashcards", { chapterId, tutorSessionId, cards });
export const updateFlashcardProgress = (id: number, correct: boolean) =>
  invoke<FlashcardRow>("update_flashcard_progress", { id, correct });

export const completeTutorSession = (
  tutorSessionId: number,
  avgConfidence: number,
  overconfidenceCount: number,
) =>
  invoke<CompleteTutorSessionResult>("complete_tutor_session", {
    tutorSessionId,
    avgConfidence,
    overconfidenceCount,
  });

export const listDueChapters = (withinDays: number) =>
  invoke<DueChapter[]>("list_due_chapters", { withinDays });

export const getUsageSummary = () => invoke<ModelUsageRow[]>("get_usage_summary");
