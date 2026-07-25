import type { QcmQuestion } from "../../lib/types";

/** Optional metadata accepted on an imported QCM question:
 *
 * "confusion": {
 *   "notion_a": "TVA collectée",
 *   "notion_b": "TVA déductible",
 *   "distinction": "La première est encaissée pour le compte de l'État ; la seconde est récupérable sous conditions."
 * }
 *
 * The regular QCM shape remains valid, so older lesson files keep working. */
export interface ConfusionCue {
  notionA: string;
  notionB: string;
  distinction: string;
}

type QuestionWithConfusion = QcmQuestion & {
  confusion?: unknown;
  confusion_frequente?: unknown;
};

const nonEmpty = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export function confusionCueForQuestion(question: QcmQuestion): ConfusionCue | null {
  const extended = question as QuestionWithConfusion;
  const raw = extended.confusion ?? extended.confusion_frequente;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const data = raw as Record<string, unknown>;
  const notionA = nonEmpty(data.notion_a) ?? nonEmpty(data.notionA);
  const notionB = nonEmpty(data.notion_b) ?? nonEmpty(data.notionB);
  const distinction = nonEmpty(data.distinction) ?? nonEmpty(data.distinction_cle) ?? nonEmpty(data.distinctionCle);
  return notionA && notionB && distinction ? { notionA, notionB, distinction } : null;
}

/** Keeps explicit comparison questions apart whenever standard questions are
 * available, so the learner alternates rule discrimination and recall rather
 * than answering a block of near-identical questions. */
export function interleaveConfusionQuestions(questions: QcmQuestion[]): QcmQuestion[] {
  const comparisons = questions.filter((question) => confusionCueForQuestion(question));
  const regular = questions.filter((question) => !confusionCueForQuestion(question));
  if (!comparisons.length || !regular.length) return questions;

  const result: QcmQuestion[] = [];
  while (comparisons.length || regular.length) {
    const comparison = comparisons.shift();
    if (comparison) result.push(comparison);
    const standard = regular.shift();
    if (standard) result.push(standard);
  }
  return result;
}
