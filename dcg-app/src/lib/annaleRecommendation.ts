import type { AnnaleAttempt } from "./types";

export interface AnnaleRecommendation {
  durationMinutes: 30 | 45 | 60;
  completedCopies: number;
  latestPercent: number;
  changeFromPrevious: number;
  copy: string;
}

function percent(attempt: AnnaleAttempt) {
  return attempt.score !== null && attempt.total && attempt.total > 0
    ? Math.round((attempt.score / attempt.total) * 100)
    : null;
}

/**
 * Uses only completed, scored copies from one UE. Two observations are the
 * minimum for a directional suggestion; before that the interface stays
 * silent rather than treating one result as a stable level.
 */
export function recommendNextAnnale(ueId: number, attempts: AnnaleAttempt[]): AnnaleRecommendation | null {
  const scored = attempts
    .filter((attempt) => attempt.ue_id === ueId && attempt.status === "completed" && percent(attempt) !== null)
    .sort((left, right) => (right.completed_at ?? right.started_at).localeCompare(left.completed_at ?? left.started_at));
  if (scored.length < 2) return null;

  const latestPercent = percent(scored[0])!;
  const previousPercent = percent(scored[1])!;
  const changeFromPrevious = latestPercent - previousPercent;
  const durationMinutes: 30 | 45 | 60 = latestPercent < 60 || changeFromPrevious <= -10
    ? 30
    : latestPercent < 75
      ? 45
      : 60;
  const trend = changeFromPrevious >= 10
    ? "la dernière copie progresse nettement"
    : changeFromPrevious <= -10
      ? "la dernière copie baisse : reprends plus court et ciblé"
      : "le niveau est proche de la copie précédente";

  return {
    durationMinutes,
    completedCopies: scored.length,
    latestPercent,
    changeFromPrevious,
    copy: `Deux copies notées ou plus permettent une recommandation : ${latestPercent}% à la dernière, ${trend}. Prévois un extrait chronométré de ${durationMinutes} min, puis passe par la reprise d’annale.`,
  };
}
