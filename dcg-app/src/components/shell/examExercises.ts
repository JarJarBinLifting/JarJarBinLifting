import type { ConceptProgress, FlashcardRow, LessonVersion } from "../../lib/types";

export type ExamExerciseFormat = "redaction" | "calcul" | "application";

export interface ExamCriterion {
  critere: string;
  points: number;
  attendu: string;
  piege?: string;
}

export interface ExamExercise {
  titre: string;
  format: ExamExerciseFormat;
  duree_minutes: number;
  notions: string[];
  etapes?: number[];
  enonce: string;
  consigne: string;
  bareme: ExamCriterion[];
  corrige: string;
}

export interface ExamSimulationTask {
  exercise: ExamExercise;
  concept: string;
  chapterName: string;
  ueCode: string;
  card: FlashcardRow | null;
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("fr")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function isExamExercise(value: unknown): value is ExamExercise {
  if (!value || typeof value !== "object") return false;
  const exercise = value as Partial<ExamExercise>;
  if (!text(exercise.titre) || !["redaction", "calcul", "application"].includes(exercise.format ?? "")) return false;
  if (!Number.isInteger(exercise.duree_minutes) || (exercise.duree_minutes ?? 0) < 3 || (exercise.duree_minutes ?? 0) > 20) return false;
  if (!Array.isArray(exercise.notions) || !exercise.notions.some(text) || !text(exercise.enonce) || !text(exercise.consigne) || !text(exercise.corrige)) return false;
  if (!Array.isArray(exercise.bareme) || exercise.bareme.length < 2) return false;
  return exercise.bareme.every((criterion) => {
    if (!criterion || typeof criterion !== "object") return false;
    const item = criterion as Partial<ExamCriterion>;
    return text(item.critere) && typeof item.points === "number" && item.points > 0 && text(item.attendu) && (item.piege === undefined || text(item.piege));
  });
}

/** Older lessons stay usable. They simply yield no exam exercise until the
 * student imports a refreshed JSON generated with prompt v5. */
export function parseExamExercises(rawJson: string): ExamExercise[] {
  try {
    const parsed = JSON.parse(rawJson) as { exercices?: unknown };
    return Array.isArray(parsed.exercices) ? parsed.exercices.filter(isExamExercise) : [];
  } catch {
    return [];
  }
}

function relevance(exercise: ExamExercise, concept: string) {
  const needle = normalize(concept);
  if (!needle) return 0;
  return exercise.notions.reduce((score, notion) => {
    const haystack = normalize(notion);
    return score + (haystack === needle ? 4 : haystack.includes(needle) || needle.includes(haystack) ? 2 : 0);
  }, 0);
}

function cardForExercise(cards: FlashcardRow[], concept: ConceptProgress, exercise: ExamExercise) {
  const requestedSteps = new Set((exercise.etapes ?? []).map(String));
  return cards.find((card) => card.concept_id === concept.concept_id)
    ?? cards.find((card) => requestedSteps.has(card.concept_id ?? ""))
    ?? cards[0]
    ?? null;
}

export function exercisesForConcept(input: {
  concept: ConceptProgress;
  version: LessonVersion | undefined;
  cards: FlashcardRow[];
}): ExamSimulationTask[] {
  const exercises = input.version ? parseExamExercises(input.version.raw_json) : [];
  const concept = input.concept.concept_label ?? input.concept.concept_id ?? input.concept.chapter_name;
  return exercises
    .map((exercise) => ({ exercise, relevance: relevance(exercise, concept) }))
    .sort((a, b) => b.relevance - a.relevance)
    .map(({ exercise }) => ({
      exercise,
      concept,
      chapterName: input.concept.chapter_name,
      ueCode: input.concept.ue_code,
      card: cardForExercise(input.cards, input.concept, exercise),
    }));
}

/** Keep the weakest concepts interleaved. When a target duration cannot be
 * filled exactly, one slightly longer first exercise is better than a blank
 * simulation — its own time target remains visible to the learner. */
export function planExamSimulation(candidates: ExamSimulationTask[], targetMinutes: number): ExamSimulationTask[] {
  const selected: ExamSimulationTask[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const task of candidates) {
    const key = `${task.chapterName}:${task.exercise.titre}`;
    if (seen.has(key)) continue;
    const duration = task.exercise.duree_minutes;
    if (selected.length && total + duration > targetMinutes) continue;
    selected.push(task);
    seen.add(key);
    total += duration;
    if (total >= targetMinutes) break;
  }
  return selected;
}

export function rubricTotal(exercise: ExamExercise) {
  return exercise.bareme.reduce((sum, criterion) => sum + criterion.points, 0);
}
