import type { ConceptProgress, ErrorNote } from "./types";

export type ExamReadinessStatus = "fragile" | "consolidation" | "reliable";

export interface ConceptReadiness {
  status: ExamReadinessStatus;
  unaidedRecallPercent: number;
  stability: "emerging" | "building" | "stable";
  recentErrors: number;
  lastExposureAt: string | null;
}

const STOP_WORDS = new Set([
  "avec", "dans", "pour", "sans", "quelle", "quel", "regle", "notion", "question", "reponse", "application", "general", "droit", "comptabilite",
]);

function normalizedWords(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
}

/** A note is attached to a concept only when its title shares a meaningful
 * term with that concept. This intentionally under-counts vague errors rather
 * than blaming every notion in the same chapter. */
function belongsToConcept(error: ErrorNote, concept: ConceptProgress) {
  if (error.chapter_id !== concept.chapter_id) return false;
  const conceptText = `${concept.concept_label ?? ""} ${concept.sample_question}`;
  const cues = normalizedWords(conceptText);
  const title = error.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
  return cues.some((cue) => title.includes(cue));
}

function isRecent(error: ErrorNote, now: Date) {
  const date = new Date(`${error.updated_at.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return error.status === "active";
  return now.getTime() - date.getTime() <= 21 * 86_400_000;
}

/** Exam readiness uses observed free recall (typed flashcards), the explicit
 * SM-2 history, and only recent, text-linked error notes. It is intentionally
 * a risk signal, never a prediction of the official DCG mark. */
export function assessConceptReadiness(
  concept: ConceptProgress,
  errorNotes: ErrorNote[],
  now = new Date(),
): ConceptReadiness {
  const unaidedRecallPercent = concept.total_cards > 0
    ? Math.round((concept.mastered_cards / concept.total_cards) * 100)
    : 0;
  const recentErrors = errorNotes.filter((error) => isRecent(error, now) && belongsToConcept(error, concept)).length;
  const stability = concept.avg_sm2_repetitions >= 3
    ? "stable"
    : concept.avg_sm2_repetitions >= 1
      ? "building"
      : "emerging";
  const status: ExamReadinessStatus = concept.due_cards > 0 || unaidedRecallPercent < 50 || recentErrors > 0
    ? "fragile"
    : unaidedRecallPercent >= 80 && stability === "stable"
      ? "reliable"
      : "consolidation";

  return {
    status,
    unaidedRecallPercent,
    stability,
    recentErrors,
    lastExposureAt: concept.last_exposure_at,
  };
}
