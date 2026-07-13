import type { ConceptConfidence, FlashcardRow, QcmQuestion } from "../../lib/types";

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

/** For a revision session, there's no fresh self-rated confidence to feed the
 * Leitner scheduler (Découverte never runs) — so instead of leaving it stuck
 * at 0 forever (which would make "strong" unreachable and stall the review
 * interval permanently), derive a proxy from demonstrated flashcard mastery,
 * scaled onto the same 1–3 range Découverte's confidence ratings use. */
export function flashcardMasteryConfidence(flashcards: FlashcardRow[]): number {
  if (!flashcards.length) return 2;
  const masteredRatio = flashcards.filter((c) => c.mastered).length / flashcards.length;
  return 1 + 2 * masteredRatio;
}

/** Plain-text digest of a session's structured results, grounding the
 * compte-rendu generation in what actually happened rather than letting the
 * model free-associate. */
export function buildSessionDigest(input: {
  confidences: ConceptConfidence[];
  qcmResult: { score: number; total: number; missed: QcmQuestion[] } | null;
  exoResult: { got: number; total: number } | null;
  overconfident: string[];
}): string {
  const lines: string[] = [];

  if (input.confidences.length) {
    lines.push("Auto-évaluation par concept :");
    input.confidences.forEach((c) => {
      const label = c.val === 3 ? "confiant" : c.val === 2 ? "compris" : "incertain";
      lines.push(`- ${c.titre} (${c.notion}) : ${label}`);
    });
  }

  if (input.qcmResult) {
    lines.push(`QCM : ${input.qcmResult.score}/${input.qcmResult.total}.`);
    if (input.qcmResult.missed.length) {
      lines.push("Questions manquées :");
      input.qcmResult.missed.forEach((q) => lines.push(`- [${q.theme || "Général"}] ${q.question}`));
    }
  }

  if (input.overconfident.length) {
    lines.push(`Surconfiance détectée (auto-évaluation "confiant" mais erreur au QCM) sur : ${input.overconfident.join(", ")}.`);
  }

  if (input.exoResult && input.exoResult.total > 0) {
    lines.push(`Cas pratique : ${input.exoResult.got}/${input.exoResult.total}.`);
  }

  return lines.length ? lines.join("\n") : "Aucune donnée structurée disponible pour cette session.";
}
