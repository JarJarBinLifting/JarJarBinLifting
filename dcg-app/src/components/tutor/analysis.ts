import type { ConceptConfidence } from "../../lib/types";

export function avgConfidence(confidences: ConceptConfidence[]): number {
  if (!confidences.length) return 0;
  return confidences.reduce((s, c) => s + c.val, 0) / confidences.length;
}

/** Concepts self-rated "I've got this" (3) whose theme shows up among the
 * QCM questions the student actually missed — the signal the Bilan phase
 * surfaces as a surprise, and the same signal fed into the Leitner update. */
export function overconfidentTitles(confidences: ConceptConfidence[], missedThemes: string[]): string[] {
  return confidences
    .filter((c) => c.val === 3 && missedThemes.some((t) => c.titre.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(c.titre.toLowerCase())))
    .map((c) => c.titre);
}
