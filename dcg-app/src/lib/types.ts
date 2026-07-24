export type ChapterStatus = "todo" | "ongoing" | "done";
export type QcmSource = "manual" | "tutor";
export type TutorSessionStatus = "in_progress" | "completed" | "abandoned";
export type ReviewOutcome = "strong" | "ok" | "weak";
export type KeyStorage = "keychain" | "plaintext_fallback" | "none";

export interface Ue {
  id: number;
  code: string;
  name: string;
  position: number;
  color: string | null;
  points_forts: string | null;
  points_faibles: string | null;
  notes: string | null;
}

export interface Chapter {
  id: number;
  ue_id: number;
  name: string;
  position: number;
  status: ChapterStatus;
}

export interface QcmScoreRow {
  id: number;
  chapter_id: number;
  tutor_session_id: number | null;
  date: string;
  score: number;
  total: number;
  source: QcmSource;
}

export interface SessionLogRow {
  id: number;
  ue_id: number | null;
  chapter_id: number | null;
  preset: string | null;
  duration_seconds: number;
  started_at: string;
  ended_at: string;
}

export interface TutorSessionRow {
  id: number;
  chapter_id: number;
  status: TutorSessionStatus;
  input_source_type: "paste" | "pdf" | "image" | null;
  story_json: string | null;
  concepts_json: string | null;
  confidence_json: string | null;
  qcm_json: string | null;
  qcm_results_json: string | null;
  qcm_score: number | null;
  qcm_total: number | null;
  socratique_transcript_json: string | null;
  exercice_json: string | null;
  bilan_json: string | null;
  adhd_mode_used: boolean;
  difficulty: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  is_revision: boolean;
  started_at: string;
  completed_at: string | null;
}

export interface ModelUsageRow {
  model: string;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
}

export type ExamSkill = "recall" | "method" | "application" | "technical" | "time";
export type ErrorType = "knowledge" | "method" | "calculation" | "reading" | "time";
export type ErrorSource = "manual" | "tutor" | "annale";
export type ErrorStatus = "active" | "mastered";

export interface ErrorNote {
  id: number;
  ue_id: number;
  ue_code: string;
  ue_name: string;
  ue_color: string | null;
  chapter_id: number | null;
  chapter_name: string | null;
  title: string;
  error_type: ErrorType;
  skill: ExamSkill;
  my_reasoning: string | null;
  correction: string | null;
  source: ErrorSource;
  ladder_step: number;
  status: ErrorStatus;
  next_review_date: string;
}

export interface SkillProfileRow {
  ue_id: number;
  skill: ExamSkill;
  score: number | null;
  note: string | null;
  recorded_at: string | null;
}

export interface ExamScenarioRow {
  ue_id: number;
  ue_code: string;
  ue_name: string;
  ue_color: string | null;
  current_mark: number | null;
  target_mark: number | null;
}

export interface FlashcardRow {
  id: number;
  chapter_id: number;
  concept_id: string | null;
  question: string;
  answer: string;
  box_level: number;
  correct_streak: number;
  mastered: boolean;
  last_reviewed_at: string | null;
  sm2_repetitions: number;
  sm2_interval_days: number;
  sm2_ease_factor: number;
}

/** One card in the daily "révision éclair" deck, with chapter/UE context. */
export interface DueFlashcard {
  id: number;
  chapter_id: number;
  chapter_name: string;
  ue_code: string;
  ue_color: string | null;
  concept_id: string | null;
  question: string;
  answer: string;
  box_level: number;
  sm2_repetitions: number;
  sm2_interval_days: number;
  sm2_ease_factor: number;
}

/** `total` counts everything due today; `cards` is capped at the daily deck
 * limit (20) server-side — the overflow stays due and fills tomorrow's deck. */
export interface DueFlashcardsResponse {
  total: number;
  cards: DueFlashcard[];
}

export interface ConceptProgress {
  chapter_id: number;
  chapter_name: string;
  ue_code: string;
  ue_color: string | null;
  concept_id: string | null;
  concept_label: string | null;
  sample_question: string;
  total_cards: number;
  mastered_cards: number;
  due_cards: number;
  avg_sm2_repetitions: number;
  next_review_date: string | null;
}

/** One question in the daily "quiz éclair" — a previously missed QCM
 * question re-asked with its original options. The correct index stays
 * server-side; answers are graded by the answer endpoint. */
export interface DueQuizItem {
  id: number;
  chapter_id: number;
  chapter_name: string;
  ue_code: string;
  ue_color: string | null;
  question: string;
  theme: string | null;
  options: string[];
}

export interface DueQuizResponse {
  total: number;
  items: DueQuizItem[];
}

export interface QuizAnswerResult {
  was_correct: boolean;
  correct: number;
  explication: string | null;
  choice_feedback: string | null;
  box_level: number;
  next_review_date: string;
}

/** One timed training run on a real past exam paper (annale). */
export interface AnnaleAttempt {
  id: number;
  ue_id: number;
  ue_code: string;
  ue_name: string;
  ue_color: string | null;
  chapter_id: number | null;
  title: string;
  subject_text: string;
  corrige_text: string | null;
  duration_minutes: number;
  exercice_json: string | null;
  answers_json: string | null;
  correction_json: string | null;
  score: number | null;
  total: number | null;
  status: "in_progress" | "completed" | "abandoned";
  started_at: string;
  completed_at: string | null;
}

export interface UeWeekTime {
  ue_id: number;
  ue_code: string;
  ue_name: string;
  ue_color: string | null;
  minutes: number;
}

export interface WeeklyAnnale {
  title: string;
  ue_code: string;
  score: number | null;
  total: number | null;
}

/** The Sunday-ritual summary — pure SQL over recorded data, no LLM. */
export interface WeeklyBilan {
  week_start: string;
  minutes_this_week: number;
  minutes_last_week: number;
  per_ue: UeWeekTime[];
  tutor_sessions_completed: number;
  cards_reviewed: number;
  quiz_answered: number;
  qcm_avg_pct: number | null;
  errors_created: number;
  errors_mastered: number;
  errors_stalled: number;
  annales: WeeklyAnnale[];
  due_next_week: number;
}

export interface BackupInfo {
  file_name: string;
  size_bytes: number;
  created_label: string;
  is_safety: boolean;
}

export interface DueChapter {
  chapter_id: number;
  chapter_name: string;
  ue_id: number;
  ue_code: string;
  ue_name: string;
  box_level: number;
  next_review_date: string;
  last_reviewed_date: string | null;
  last_outcome: ReviewOutcome | null;
}

export interface WeakChapter {
  chapter_id: number;
  chapter_name: string;
  ue_id: number;
  ue_code: string;
  ue_name: string;
  ue_color: string | null;
  box_level: number | null;
  last_outcome: ReviewOutcome | null;
  next_review_date: string | null;
  latest_qcm_score: number | null;
  latest_qcm_total: number | null;
}

export interface CompleteTutorSessionResult {
  chapter: Chapter;
  qcm_score_row: QcmScoreRow;
  box_level: number;
  outcome: ReviewOutcome;
  next_review_date: string;
}

export interface ApiKeyStatus {
  has_key: boolean;
  storage: KeyStorage;
}

export interface LocalConfig {
  db_path: string | null;
  /** Whether the database connection is actually open right now — distinct
   * from db_path being recorded, since a configured file can go missing or
   * fail to open between runs. */
  db_open: boolean;
}

// ─── Tutor domain shapes (LLM-generated JSON, parsed from the *_json columns) ───

export type ActivityType = "prediction" | "liaison" | "contrefactuel";

export interface StoryEtape {
  titre_court: string;
  contexte_narratif: string;
  type_activite: ActivityType;
  question_activite: string;
  hypotheses: string[];
  notion: string;
  explication: string;
  application: string;
  a_retenir: string;
  question_rappel: string;
}

export interface Story {
  titre: string;
  scenario: string;
  personnage: string;
  entreprise: string;
  etapes: StoryEtape[];
  epilogue: string;
}

export interface ConceptConfidence {
  step: number;
  val: 1 | 2 | 3;
  titre: string;
  notion: string;
}

export interface QcmQuestion {
  question: string;
  theme: string;
  options: string[];
  correct: number;
  explication: string;
  /** Optional on older imports; aligned with `options` and explains why each
   * choice is right or tempting. */
  option_feedbacks?: string[];
}

export interface Qcm {
  questions: QcmQuestion[];
}

export interface ExoQuestion {
  numero: number;
  enonce: string;
  points: number;
}

export interface ExoDossier {
  numero: number;
  titre: string;
  points: number;
  questions: ExoQuestion[];
}

export interface Exercice {
  titre: string;
  contexte: string;
  dossiers: ExoDossier[];
  total_points: number;
}

export interface ExoCorrectionItem {
  dossier: number;
  question: number;
  note: number;
  bareme: number;
  evaluation: string;
  reponse_attendue: string;
}

export interface ExoCorrection {
  corrections: ExoCorrectionItem[];
  total: number;
  appreciation: string;
}

export interface Bilan {
  weakConcepts: string[];
  midConcepts: string[];
  missedThemes: string[];
  overconfident: string[];
}
