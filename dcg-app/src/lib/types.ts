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
