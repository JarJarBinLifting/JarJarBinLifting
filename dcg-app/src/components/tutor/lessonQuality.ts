import type { QcmQuestion, Story } from "../../lib/types";

export type LessonFlashcard = {
  recto: string;
  verso: string;
  theme?: string;
  etape?: number;
};

export interface LessonQualityAudit {
  blockers: string[];
  warnings: string[];
}

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("fr")
  .replace(/\s+/g, " ")
  .trim();

const nonEmptyText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Audits the parts of a generated lesson that can be checked without
 * pretending to know facts absent from the source chapter. Structural
 * contradictions block import; coverage and pedagogical thinness remain
 * explicit warnings for the learner to inspect before studying. */
export function auditLessonQuality(input: {
  story: Story;
  flashcards: LessonFlashcard[];
  questions: QcmQuestion[];
  source?: string;
  declaredChapter?: string;
  expectedChapter?: string;
  declaredUe?: string;
  expectedUe?: string;
}): LessonQualityAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const { story, flashcards, questions } = input;

  if (!input.source?.trim()) {
    warnings.push("Source du chapitre absente : vérifie le contenu contre ton support avant de l'étudier.");
  }
  if (!input.declaredChapter?.trim()) {
    warnings.push("Chapitre source absent : l'app ne peut pas confirmer le rattachement de cette leçon.");
  }
  if (input.expectedChapter && input.declaredChapter && normalize(input.expectedChapter) !== normalize(input.declaredChapter)) {
    blockers.push(`Cette leçon annonce le chapitre « ${input.declaredChapter} », alors que tu ouvres « ${input.expectedChapter} ».`);
  }
  if (input.expectedUe && input.declaredUe && normalize(input.expectedUe) !== normalize(input.declaredUe)) {
    blockers.push(`Cette leçon annonce l'UE ${input.declaredUe}, alors que tu ouvres ${input.expectedUe}.`);
  }

  const cardsByStep = new Set<number>();
  const cardsByQuestion = new Map<string, string>();
  flashcards.forEach((card, index) => {
    if (typeof card.etape === "number" && Number.isInteger(card.etape) && card.etape > 0) {
      if (card.etape > story.etapes.length) warnings.push(`Flashcard ${index + 1} : l'étape ${card.etape} n'existe pas dans l'histoire.`);
      else cardsByStep.add(card.etape);
    }
    const question = normalize(card.recto ?? "");
    const answer = normalize(card.verso ?? "");
    const previous = cardsByQuestion.get(question);
    if (question && previous && previous !== answer) blockers.push(`Flashcards contradictoires : le recto « ${card.recto} » a deux réponses différentes.`);
    if (question) cardsByQuestion.set(question, answer);
    if ((card.verso ?? "").trim().length < 24) warnings.push(`Flashcard ${index + 1} : le verso est très court ; vérifie qu'il justifie bien la règle.`);
  });

  const missingSteps = story.etapes
    .map((_, index) => index + 1)
    .filter((step) => !cardsByStep.has(step));
  if (missingSteps.length) warnings.push(`Notions possiblement sans carte dédiée : étapes ${missingSteps.join(", ")}.`);

  const seenQuestions = new Set<string>();
  questions.forEach((question, index) => {
    const questionText = normalize(question.question ?? "");
    if (seenQuestions.has(questionText)) warnings.push(`QCM ${index + 1} : énoncé très proche d'une question précédente ; vérifie qu'il teste une autre décision.`);
    if (questionText) seenQuestions.add(questionText);

    const options = question.options.filter(nonEmptyText).map(normalize);
    if (new Set(options).size !== question.options.length) blockers.push(`QCM ${index + 1} : au moins deux options sont identiques ; il n'y a pas de vrai distracteur.`);
    const correctOption = options[question.correct];
    if (correctOption && options.filter((option) => option === correctOption).length > 1) blockers.push(`QCM ${index + 1} : la bonne réponse est dupliquée parmi les options.`);
    if ((question.explication ?? "").trim().length < 40) warnings.push(`QCM ${index + 1} : justification trop courte ; explique la règle et son application.`);

    const feedbacks = question.option_feedbacks;
    if (!feedbacks) {
      warnings.push(`QCM ${index + 1} : feedback des distracteurs absent.`);
    } else {
      const distinctFeedbacks = new Set(feedbacks.map(normalize));
      if (distinctFeedbacks.size !== feedbacks.length) warnings.push(`QCM ${index + 1} : plusieurs feedbacks sont identiques ; les distracteurs ne sont peut-être pas réellement expliqués.`);
      feedbacks.forEach((feedback, optionIndex) => {
        if (optionIndex !== question.correct && feedback.trim().length < 35) warnings.push(`QCM ${index + 1}, distracteur ${optionIndex + 1} : explique pourquoi il est tentant avant de le corriger.`);
      });
    }
  });

  if (story.etapes.some((step) => step.explication.trim().length < 45 || step.question_rappel.trim().length < 12)) {
    warnings.push("Certaines notions ont une explication ou un rappel trop bref : vérifie qu'elles permettent un vrai rappel actif.");
  }
  warnings.push("Le contrôle automatique vérifie la cohérence interne ; il ne remplace pas la comparaison des règles avec le support source.");

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}
