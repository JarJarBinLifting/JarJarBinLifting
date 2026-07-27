import type { QcmQuestion, SourceReference } from "../../lib/types";
import { confusionCueForQuestion } from "./confusions";

export interface ImportedFlashcardDraft {
  concept_id: string;
  question: string;
  answer: string;
  source_ref?: SourceReference;
}

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Turns comparison metadata supplied with an imported lesson into source-bound
 * active-recall cards. A pair is deliberately saved once, even if several QCM
 * questions use it, so reviews stay concise and genuinely interleaved.
 */
export function buildConfusionFlashcards(questions: QcmQuestion[]): ImportedFlashcardDraft[] {
  const seen = new Set<string>();
  const cards: ImportedFlashcardDraft[] = [];

  for (const question of questions) {
    const cue = confusionCueForQuestion(question);
    if (!cue) continue;

    const notions = [normalize(cue.notionA), normalize(cue.notionB)].sort();
    if (!notions[0] || notions[0] === notions[1]) continue;

    const signature = notions.join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);

    cards.push({
      concept_id: `confusion:${signature}`,
      question: `Sans consulter le cours, distingue « ${cue.notionA} » de « ${cue.notionB} ». Quel critère décisif les sépare ?`,
      answer: `Différence décisive : ${cue.distinction}`,
      source_ref: question.source_ref,
    });
  }

  return cards;
}
