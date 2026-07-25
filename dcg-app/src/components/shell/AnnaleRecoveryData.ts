import type { AnnaleAttempt, ErrorNote, Exercice, ExoCorrectionItem } from "../../lib/types";

export const RECOVERY_LADDER = [
  "Rappel actif",
  "Application guidée",
  "Mini-cas autonome",
  "Extrait chronométré",
  "Maîtrisé",
];

export const SKILL_LABELS = {
  recall: "Restitution",
  method: "Choix de méthode",
  application: "Application",
  technical: "Technique",
  time: "Gestion du temps",
} as const;

export const ERROR_TYPE_LABELS = {
  knowledge: "Connaissance",
  method: "Méthode",
  calculation: "Calcul / technique",
  reading: "Lecture du sujet",
  time: "Gestion du temps",
} as const;

export type RecoveryItem = {
  correction: ExoCorrectionItem;
  question: string | null;
  dossierTitle: string | null;
  error: ErrorNote | null;
};

export function parseJson<T>(source: string | null): T | null {
  if (!source) return null;
  try {
    return JSON.parse(source) as T;
  } catch {
    return null;
  }
}

export function percent(score: number | null, total: number | null) {
  if (score === null || !total) return null;
  return Math.round((score / total) * 100);
}

export function previousCompletedAttempt(attempt: AnnaleAttempt, attempts: AnnaleAttempt[]) {
  const currentDate = attempt.completed_at ?? attempt.started_at;
  return attempts
    .filter((candidate) => candidate.id !== attempt.id
      && candidate.status === "completed"
      && candidate.ue_id === attempt.ue_id
      && candidate.score !== null
      && candidate.total
      && (candidate.completed_at ?? candidate.started_at) < currentDate)
    .sort((a, b) => (b.completed_at ?? b.started_at).localeCompare(a.completed_at ?? a.started_at))[0] ?? null;
}

function normalise(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function questionFor(exercise: Exercice | null, item: ExoCorrectionItem) {
  const dossier = exercise?.dossiers.find((entry) => entry.numero === item.dossier) ?? null;
  return {
    dossierTitle: dossier?.titre ?? null,
    question: dossier?.questions.find((entry) => entry.numero === item.question)?.enonce ?? null,
  };
}

function errorFor(
  attempt: AnnaleAttempt,
  item: ExoCorrectionItem,
  question: string | null,
  errors: ErrorNote[],
) {
  const candidates = errors.filter((error) => error.source === "annale"
    && error.ue_id === attempt.ue_id
    && error.title.startsWith(`${attempt.title} —`));
  const questionPrefix = question ? normalise(question).slice(0, 48) : null;
  const position = normalise(`d${item.dossier}q${item.question}`);

  return candidates.find((error) => {
    const title = normalise(error.title);
    return (questionPrefix !== null && title.includes(questionPrefix)) || title.includes(position);
  }) ?? null;
}

/**
 * Only unanswered points are shown here. The correction remains hidden by
 * default in the UI so a learner must attempt the recall before reading it.
 */
export function recoveryItems(attempt: AnnaleAttempt, errors: ErrorNote[]): RecoveryItem[] {
  const correction = parseJson<{ corrections?: ExoCorrectionItem[] }>(attempt.correction_json);
  const exercise = parseJson<Exercice>(attempt.exercice_json);
  return (correction?.corrections ?? [])
    .filter((item) => item.bareme > 0 && item.note < item.bareme)
    .map((item) => {
      const detail = questionFor(exercise, item);
      return {
        correction: item,
        question: detail.question,
        dossierTitle: detail.dossierTitle,
        error: errorFor(attempt, item, detail.question, errors),
      };
    });
}
