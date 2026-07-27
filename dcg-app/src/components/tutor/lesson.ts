import type { ConceptConfidence, QcmQuestion, SourceReference, Story } from "../../lib/types";
import { hasUsableSourceReference } from "../../lib/sourceReference";
import { isExamExercise, type ExamExercise } from "../shell/examExercises";
import { confusionCueForQuestion } from "./confusions";
import { auditLessonQuality } from "./lessonQuality";
import { DIFFS, type Diff } from "./prompts";

/** A lesson generated in a claude.ai chat (subscription — no API key) and
 * imported as a file: everything a session normally asks the API for, in the
 * exact shapes the tutor already stores (story_json / flashcards / qcm_json).
 * Sessions started from one run fully offline. */
export interface LessonFile {
  format: "dcg-lesson";
  version: number;
  prompt_version?: number;
  chapitre?: string;
  ue?: string;
  source?: string;
  generated_at?: string;
  generated_with?: string;
  difficulty: Diff;
  story: Story;
  flashcards: { recto: string; verso: string; theme?: string; etape?: number; source_ref?: SourceReference }[];
  qcm: { questions: QcmQuestion[] };
  /** Short, source-grounded exercises used by the adaptive DCG simulations. */
  exercices?: ExamExercise[];
}

export const LESSON_FORMAT_VERSION = 2;
export const LESSON_PROMPT_VERSION = 6;

export interface LessonInspection {
  lesson: LessonFile;
  warnings: string[];
  stats: {
    storySteps: number;
    flashcards: number;
    qcmQuestions: number;
    sourceReferences: number;
  };
}

/** The prompt the student pastes into claude.ai together with the chapter
 * content (text or attached PDF). Mirrors prompts.story / prompts.flash /
 * prompts.qcm so the file slots into the same storage and phase components,
 * plus per-hypothesis `feedbacks` to stand in for the live feedback call. */
export function buildLessonPrompt(ueCode: string, chapterName: string, diff: Diff): string {
  return `Expert DCG ${ueCode}, pédagogue brillant. À partir du contenu de cours que je te fournis (chapitre « ${chapterName} »), génère une leçon complète pour mon application de révision, sous la forme d'UN SEUL fichier JSON téléchargeable nommé "dcg-lecon.json".

Le fichier doit suivre EXACTEMENT cette structure :
{
  "format": "dcg-lesson",
  "version": 2,
  "prompt_version": ${LESSON_PROMPT_VERSION},
  "chapitre": "${chapterName}",
  "ue": "${ueCode}",
  "source": "Titre, auteur ou nom du support fourni si identifiable",
  "generated_at": "AAAA-MM-JJ",
  "generated_with": "Nom du modèle utilisé",
  "difficulty": "${diff}",
  "story": { … },
  "flashcards": [ … ],
  "qcm": { "questions": [ … ] },
  "exercices": [ … ]
}

1. "story" — transforme le chapitre en HISTOIRE IMMERSIVE.
COUVERTURE COMPLÈTE OBLIGATOIRE : identifie TOUTES les notions distinctes et testables du contenu fourni, sans exception. Une étape par notion — n'en saute, ne fusionne, ni ne résume aucune. Un chapitre dense peut produire 15, 20 étapes ou plus ; pas de plafond artificiel.
Invente un personnage et une entreprise réaliste. Chaque étape introduit UNE notion via ce qui arrive au personnage.
Pour chaque étape, VARIE le "type_activite" en alternant entre :
- "prediction" : l'étudiant prédit le concept avant de le découvrir
- "liaison" : relier la situation à un concept d'une étape PRÉCÉDENTE — uniquement à partir de l'étape 3
- "contrefactuel" : raisonnement inversé ("si X avait fait Y, que se serait-il passé ?")
Structure de "story" :
{
  "titre":"...","scenario":"Présentation 2-3 phrases","personnage":"Prénom","entreprise":"Nom + activité en 1 phrase",
  "etapes":[{
    "titre_court":"Notion (3-5 mots)",
    "contexte_narratif":"Ce qui arrive au personnage (2-3 phrases vivantes)",
    "type_activite":"prediction|liaison|contrefactuel",
    "question_activite":"La question posée à l'étudiant",
    "hypotheses":["réponse plausible 1","réponse plausible 2","réponse plausible 3"],
    "feedbacks":["retour si l'étudiant choisit l'hypothèse 1","retour pour l'hypothèse 2","retour pour l'hypothèse 3"],
    "notion":"Le concept précis",
    "explication":"Explication claire, 3-5 phrases",
    "application":"Application concrète dans l'histoire, 2-3 phrases",
    "a_retenir":"UNE phrase clé",
    "question_rappel":"Question de rappel rapide sur CE concept"
  }],
  "epilogue":"Conclusion 2-3 phrases"
}
"hypotheses" : 3 réponses courtes plausibles à la question_activite — une correcte ou très proche, deux plausibles mais inexactes (erreurs classiques d'étudiants), en ordre aléatoire. "feedbacks" : pour CHAQUE hypothèse (même ordre), un retour bienveillant de 2-3 phrases qui commence TOUJOURS par relever ce qui est juste ou pertinent dans ce choix, puis introduit le vrai concept — jamais de reproche ni de « non ».

2. "flashcards" — les cartes couvrant TOUTES les notions essentielles, sans exception : au moins une carte par étape de l'histoire, plus une carte pour chaque notion secondaire importante (définition, exception, condition). Pas de plafond fixe. Quand pertinent, contextualise le recto dans l'univers de l'histoire ; le verso reste la règle générale précise. Chaque carte : {"recto":"...","verso":"...","theme":"Thème court","etape":1} — "etape" (base 1) référence l'étape de l'histoire, 0 pour une notion secondaire.

3. "qcm" — 12 questions niveau ${diff}. ${
    diff === "Annales" ? "Complexité annales DCG." : diff === "Intermédiaire" ? "Difficulté intermédiaire." : "Questions fondamentales."
  } 2-3 questions peuvent réutiliser le contexte de l'histoire, les autres restent générales. Inclus AU MOINS 3 questions de DISCRIMINATION entre notions voisines souvent confondues (distracteurs construits sur les confusions classiques). Pour chacune de ces 3 questions, ajoute obligatoirement "confusion":{"notion_a":"notion A","notion_b":"notion B","distinction":"règle courte qui les sépare"} : les deux notions doivent être réellement enseignées dans le chapitre et la distinction doit être directement réutilisable en révision. Chaque question : {"question":"...","theme":"Thème court","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explication":"...","option_feedbacks":["pourquoi l'option A est juste ou tentante","…","…","…"],"confusion":{"notion_a":"...","notion_b":"...","distinction":"..."}} — "correct" est l'index (0-3) de la bonne option, "explication" justifie la bonne réponse en 2-3 phrases. "option_feedbacks" contient EXACTEMENT 4 retours dans le même ordre que les options : pour chaque distracteur, explique explicitement POURQUOI il paraît crédible puis la distinction qui le rend faux. Pour la bonne réponse, confirme le raisonnement décisif.

4. "exercices" — 4 à 6 mini-exercices réellement tirés du chapitre, utilisables dans une simulation DCG de 12 à 45 minutes. Chaque exercice demande une réponse rédigée, un raisonnement ou un calcul (jamais un QCM décoratif), dure 3 à 20 minutes et suit exactement : {"titre":"...","format":"redaction|calcul|application","duree_minutes":8,"notions":["notion précise"],"etapes":[1],"enonce":"cas ou données fidèles au support","consigne":"ce que l'étudiant doit produire","bareme":[{"critere":"Décision attendue","points":2,"attendu":"élément précis à faire apparaître","piege":"erreur fréquente et pourquoi elle est tentante"},{"critere":"Justification","points":2,"attendu":"règle, calcul ou condition à expliciter","piege":"..."}],"corrige":"corrigé rédigé et structuré"}. "etapes" référence les étapes de l'histoire concernées (base 1). Le barème contient au moins 2 critères ; chaque "attendu" guide l'auto-correction et chaque "piege" explique l'erreur séduisante à éviter. Ne prétends jamais noter automatiquement une rédaction.

5. "source_ref" — ANCRAGE OBLIGATOIRE AU SUPPORT. Chaque flashcard, chaque question de QCM et chaque mini-exercice doit contenir exactement : "source_ref":{"section":"Titre ou repère de la section, si identifiable","extrait":"citation littérale de 20 à 800 caractères tirée du chapitre fourni"}. L'extrait doit être recopié fidèlement du support, jamais résumé ni inventé. Il doit suffire à justifier la règle, le calcul ou la distinction demandée. Si tu ne peux pas citer un passage précis, n'invente pas l'élément : omets-le plutôt et signale la limite dans le contenu restant.
IMPORTANT :
- Rends le résultat sous forme d'un fichier "dcg-lecon.json" téléchargeable (pas dans le fil de la conversation).
- Le fichier contient UNIQUEMENT le JSON, sans markdown, sans commentaire.
- Tout le contenu est en français.
- Ne complète jamais le cours avec des règles dont tu n'es pas certain. Si le support est ambigu ou incomplet, reste fidèle au texte fourni.
- Vérifie une dernière fois que les index "correct" correspondent réellement à la bonne option avant de créer le fichier.

Voici le contenu du chapitre :`;
}

class LessonError extends Error {}

function fail(msg: string): never {
  throw new LessonError(msg);
}

/** Parses + validates an imported lesson file. Throws a French, user-facing
 * message naming what's wrong — the file is hand-carried from a chat, so
 * "invalid" needs to say what to go fix. */
export function inspectLessonFile(raw: string, expectedChapter?: string, expectedUe?: string): LessonInspection {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("Ce fichier n'est pas du JSON valide. Redemande à Claude le fichier dcg-lecon.json complet, sans texte autour.");
  }

  if (data?.format !== "dcg-lesson") fail('Ce fichier n\'est pas une leçon DCG (champ "format" attendu : "dcg-lesson").');
  if (typeof data.version !== "number" || data.version < 1 || data.version > LESSON_FORMAT_VERSION) {
    fail(`Version de leçon ${data?.version ?? "?"} non reconnue — cette application lit les versions jusqu'à ${LESSON_FORMAT_VERSION}.`);
  }

  const story = data.story;
  if (!story || typeof story !== "object") fail('Le champ "story" est manquant.');
  if (!Array.isArray(story.etapes) || story.etapes.length === 0) fail("L'histoire ne contient aucune étape.");
  story.etapes.forEach((e: any, i: number) => {
    for (const field of ["titre_court", "contexte_narratif", "question_activite", "notion", "explication", "application", "a_retenir", "question_rappel"]) {
      if (typeof e?.[field] !== "string" || !e[field].trim()) fail(`Étape ${i + 1} de l'histoire : champ "${field}" manquant ou vide.`);
    }
    if (!["prediction", "liaison", "contrefactuel"].includes(e.type_activite)) fail(`Étape ${i + 1} : "type_activite" doit être prediction, liaison ou contrefactuel.`);
    if (!Array.isArray(e.hypotheses) || e.hypotheses.length !== 3 || e.hypotheses.some((item: unknown) => typeof item !== "string" || !item.trim())) fail(`Étape ${i + 1} : il faut exactement 3 hypothèses non vides.`);
    if (!Array.isArray(e.feedbacks) || e.feedbacks.length !== e.hypotheses.length || e.feedbacks.some((item: unknown) => typeof item !== "string" || !item.trim())) fail(`Étape ${i + 1} : il faut un feedback non vide pour chacune des 3 hypothèses.`);
  });
  for (const field of ["titre", "scenario", "personnage", "epilogue"]) {
    if (typeof story[field] !== "string") story[field] = "";
  }
  if (typeof story.entreprise !== "string") story.entreprise = "";

  if (!Array.isArray(data.flashcards) || data.flashcards.length === 0) fail("Aucune flashcard dans le fichier.");
  data.flashcards.forEach((c: any, i: number) => {
    if (typeof c?.recto !== "string" || !c.recto.trim() || typeof c?.verso !== "string" || !c.verso.trim()) {
      fail(`Flashcard ${i + 1} : "recto" et "verso" sont obligatoires.`);
    }
  });

  const questions = data.qcm?.questions;
  if (!Array.isArray(questions) || questions.length === 0) fail("Aucune question de QCM dans le fichier.");
  questions.forEach((q: any, i: number) => {
    if (typeof q?.question !== "string" || !q.question.trim()) fail(`Question ${i + 1} du QCM : énoncé manquant.`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((option: unknown) => typeof option !== "string" || !option.trim())) fail(`Question ${i + 1} du QCM : il faut exactement 4 options non vides.`);
    if (typeof q.correct !== "number" || !Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) {
      fail(`Question ${i + 1} du QCM : "correct" doit être l'index (0-${q.options.length - 1}) de la bonne option.`);
    }
    if (typeof q.theme !== "string") q.theme = "";
    if (typeof q.explication !== "string" || !q.explication.trim()) fail(`Question ${i + 1} du QCM : l'explication de la bonne réponse est manquante.`);
    if (q.option_feedbacks !== undefined && (!Array.isArray(q.option_feedbacks) || q.option_feedbacks.length !== q.options.length || q.option_feedbacks.some((item: unknown) => typeof item !== "string" || !item.trim()))) {
      fail(`Question ${i + 1} du QCM : "option_feedbacks" doit contenir un retour non vide pour chacune des 4 options.`);
    }
    if (q.confusion !== undefined && !confusionCueForQuestion(q as QcmQuestion)) {
      fail(`Question ${i + 1} du QCM : "confusion" doit contenir notion_a, notion_b et distinction non vides.`);
    }
  });

  const exercises = data.exercices;
  if (exercises !== undefined && (!Array.isArray(exercises) || exercises.some((exercise: unknown) => !isExamExercise(exercise)))) {
    fail('Le champ "exercices" doit contenir des exercices avec format, durée, notions, consigne, barème et corrigé valides.');
  }

  const sourceReferenceItems = [
    ...data.flashcards.map((card: any, index: number) => ({ label: `Flashcard ${index + 1}`, value: card?.source_ref })),
    ...questions.map((question: any, index: number) => ({ label: `Question ${index + 1} du QCM`, value: question?.source_ref })),
    ...(Array.isArray(exercises) ? exercises.map((exercise: any, index: number) => ({ label: `Exercice ${index + 1}`, value: exercise?.source_ref })) : []),
  ];
  const missingSourceReferences = sourceReferenceItems.filter((item) => !hasUsableSourceReference(item.value));
  const requiresSourceReferences = typeof data.prompt_version === "number" && data.prompt_version >= LESSON_PROMPT_VERSION;
  if (requiresSourceReferences && missingSourceReferences.length) {
    fail(`${missingSourceReferences[0].label} : "source_ref.extrait" doit citer au moins ${20} caractères exacts du support (prompt v${LESSON_PROMPT_VERSION}).`);
  }
  const warnings: string[] = [];
  const difficulty: Diff = (DIFFS as readonly string[]).includes(data.difficulty) ? data.difficulty : DIFFS[0];
  if (!(DIFFS as readonly string[]).includes(data.difficulty)) {
    warnings.push(`Difficulté non reconnue : « ${String(data.difficulty ?? "absente")} ». Le niveau « ${difficulty} » sera utilisé.`);
  }
  if (story.etapes.length < 5) warnings.push("La leçon contient moins de 5 notions : vérifie que tout le chapitre a bien été fourni au LLM.");
  if (data.flashcards.length < story.etapes.length) warnings.push("Il y a moins de flashcards que de notions dans l'histoire.");
  if (questions.length < 10) warnings.push("Le QCM contient moins de 10 questions ; la vérification sera moins représentative.");
  if (questions.some((q: QcmQuestion) => !q.option_feedbacks)) {
    warnings.push("Cette leçon utilise l'ancien feedback de QCM : régénère-la avec le prompt v4 pour expliquer pourquoi chaque distracteur est tentant.");
  }
  const confusionCount = questions.filter((q: QcmQuestion) => Boolean(confusionCueForQuestion(q))).length;
  if (confusionCount < 3) {
    warnings.push(`Cette leçon ne déclare que ${confusionCount} question${confusionCount > 1 ? "s" : ""} de confusion ; le prompt v4 en demande au moins 3.`);
  }
  if (!Array.isArray(exercises) || exercises.length === 0) {
    warnings.push("Cette leçon ne contient pas encore de mini-exercices de simulation : régénère-la avec le prompt v5 pour t'entraîner au format DCG.");
  } else if (exercises.length < 4) {
    warnings.push("Cette leçon contient moins de 4 mini-exercices : une simulation longue couvrira moins de notions.");
  }
  if (missingSourceReferences.length) {
    warnings.push(`Cette leçon ne relie pas encore tous ses éléments au support : ${missingSourceReferences.length}/${sourceReferenceItems.length} extrait${missingSourceReferences.length > 1 ? "s" : ""} source manquant${missingSourceReferences.length > 1 ? "s" : ""}. Régénère-la avec le prompt v6 pour pouvoir vérifier chaque règle.`);
  }
  const quality = auditLessonQuality({
    story: story as Story,
    flashcards: data.flashcards,
    questions,
    source: typeof data.source === "string" ? data.source : undefined,
    declaredChapter: typeof data.chapitre === "string" ? data.chapitre : undefined,
    expectedChapter,
    declaredUe: typeof data.ue === "string" ? data.ue : undefined,
    expectedUe,
  });
  if (quality.blockers.length) fail(quality.blockers.join(" "));
  warnings.push(...quality.warnings);

  const lesson: LessonFile = {
    format: "dcg-lesson",
    version: data.version,
    prompt_version: typeof data.prompt_version === "number" ? data.prompt_version : undefined,
    chapitre: typeof data.chapitre === "string" ? data.chapitre : undefined,
    ue: typeof data.ue === "string" ? data.ue : undefined,
    source: typeof data.source === "string" ? data.source : undefined,
    generated_at: typeof data.generated_at === "string" ? data.generated_at : undefined,
    generated_with: typeof data.generated_with === "string" ? data.generated_with : undefined,
    difficulty,
    story: story as Story,
    flashcards: data.flashcards,
    qcm: { questions },
    exercices: Array.isArray(exercises) ? exercises as ExamExercise[] : undefined,
  };

  return {
    lesson,
    warnings,
    stats: {
      storySteps: story.etapes.length,
      flashcards: data.flashcards.length,
      qcmQuestions: questions.length,
      sourceReferences: sourceReferenceItems.length - missingSourceReferences.length,
    },
  };
}

export function parseLessonFile(raw: string): LessonFile {
  return inspectLessonFile(raw).lesson;
}

/** Offline stand-in for prompts.compteRendu: composes the next-revision note
 * directly from the session's structured results. Same contract as the model
 * version — difficulties first, then solid points, then one priority. */
export function composeLocalCompteRendu(input: {
  confidences: ConceptConfidence[];
  qcmResult: { score: number; total: number; missed: QcmQuestion[] } | null;
  overconfident: string[];
}): string {
  const parts: string[] = [];

  const weakConcepts = input.confidences.filter((c) => c.val === 1).map((c) => c.titre);
  const missedThemes = [...new Set((input.qcmResult?.missed ?? []).map((q) => q.theme || "Général"))];
  const difficulties = [...new Set([...missedThemes, ...weakConcepts])];
  if (difficulties.length) {
    parts.push(`Difficultés relevées sur : ${difficulties.join(", ")}.`);
  }
  if (input.overconfident.length) {
    parts.push(`Surconfiance (auto-évalué « je maîtrise » mais erreur au QCM) sur : ${input.overconfident.join(", ")}.`);
  }

  const strong = input.confidences
    .filter((c) => c.val === 3 && !input.overconfident.includes(c.titre) && !missedThemes.some((t) => c.titre.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(c.titre.toLowerCase())))
    .map((c) => c.titre);
  if (strong.length) {
    parts.push(`Points solides, à ne pas re-tester en priorité : ${strong.join(", ")}.`);
  }

  if (input.qcmResult) {
    parts.push(`QCM : ${input.qcmResult.score}/${input.qcmResult.total}.`);
  }

  parts.push(
    difficulties.length
      ? `Priorité pour la prochaine session : ${difficulties[0]}.`
      : "Aucune difficulté particulière relevée — la prochaine session peut élargir ou monter en difficulté.",
  );

  return parts.join(" ");
}
