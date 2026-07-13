export const ACT_TYPES: Record<string, { label: string; hint: string }> = {
  prediction: { label: "🤔 À toi de prédire", hint: "Ce que je pense…" },
  liaison: { label: "🔗 Fais le lien", hint: "Le lien que je vois…" },
  contrefactuel: { label: "🔮 Et si… ?", hint: "Ce qui se passerait…" },
};

export const KIND_TUTOR =
  `RÈGLE ABSOLUE DE TON: commence TOUJOURS par relever ce qui est juste, pertinent ou prometteur dans la réponse, ` +
  `même minime. Jamais de reproche ni de "non". Présente toute erreur comme une information utile pour progresser, ` +
  `jamais comme un échec. Ton chaleureux, direct, encourageant.`;

export const prompts = {
  story: (ue: string) => `Expert DCG ${ue}, pédagogue brillant. Transforme le chapitre en HISTOIRE IMMERSIVE.
Invente un personnage et une entreprise réaliste. Chaque étape introduit UNE notion via ce qui arrive au personnage.
Pour chaque étape, VARIE le type d'activité (champ "type_activite") en alternant entre:
- "prediction": l'étudiant prédit le concept avant de le découvrir
- "liaison": relier la situation à un concept d'une étape PRÉCÉDENTE — uniquement à partir de l'étape 3
- "contrefactuel": raisonnement inversé ("si X avait fait Y, que se serait-il passé ?")
Pour CHAQUE étape, fournis aussi "hypotheses": 3 réponses courtes plausibles à la question_activite — une correcte ou très proche, deux plausibles mais inexactes (erreurs classiques d'étudiants). Ordre aléatoire.
JSON pur (pas de markdown):
{
  "titre":"...","scenario":"Présentation 2-3 phrases","personnage":"Prénom","entreprise":"Nom + activité en 1 phrase",
  "etapes":[{
    "titre_court":"Notion (3-5 mots)",
    "contexte_narratif":"Ce qui arrive au personnage (2-3 phrases vivantes)",
    "type_activite":"prediction|liaison|contrefactuel",
    "question_activite":"La question posée à l'étudiant",
    "hypotheses":["réponse plausible 1","réponse plausible 2","réponse plausible 3"],
    "notion":"Le concept précis",
    "explication":"Explication claire, 3-5 phrases",
    "application":"Application concrète dans l'histoire, 2-3 phrases",
    "a_retenir":"UNE phrase clé",
    "question_rappel":"Question de rappel rapide sur CE concept"
  }],
  "epilogue":"Conclusion 2-3 phrases"
}
6 à 8 étapes max. Alterne vraiment les types. IMPORTANT: réponds UNIQUEMENT avec le JSON.`,

  flash: (ue: string, story: any) => `Expert DCG ${ue}. 12 flashcards couvrant TOUTES les notions essentielles du chapitre.
CONTEXTE NARRATIF: l'étudiant a appris via l'histoire de ${story.personnage} (${story.entreprise}). Étapes:
${story.etapes.map((e: any, i: number) => `${i + 1}. ${e.titre_court} — ${e.notion}`).join("\n")}
Quand pertinent, contextualise le recto dans cet univers. Le verso reste la règle générale précise.
Chaque carte référence son étape via "etape" (1-based).
JSON pur: {"cards":[{"recto":"...","verso":"...","theme":"Thème court","etape":1}]}
IMPORTANT: réponds UNIQUEMENT avec le JSON.`,

  qcm: (ue: string, diff: string, story: any | null, priorCompteRendu?: string | null) => `Expert DCG ${ue}. 10 QCM niveau ${diff}. ${
    diff === "Annales" ? "Complexité annales DCG." : diff === "Intermédiaire" ? "Difficulté intermédiaire." : "Questions fondamentales."
  }
${story ? `2-3 questions peuvent réutiliser le contexte de ${story.personnage} (${story.entreprise}), les autres restent générales.` : ""}
Inclus 2-3 questions de DISCRIMINATION entre notions voisines souvent confondues (distracteurs construits sur les confusions classiques).
${priorCompteRendu ? `NOTE DE LA SESSION PRÉCÉDENTE SUR CE CHAPITRE : ${priorCompteRendu}\nAu moins 3 questions doivent cibler précisément ces points faibles.` : ""}
JSON pur: {"questions":[{"question":"...","theme":"Thème court","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explication":"..."}]}
IMPORTANT: réponds UNIQUEMENT avec le JSON.`,

  feedback: (ue: string, type: string, notion: string, explication: string) => `Tuteur DCG ${ue}. L'étudiant répond à une activité de type "${type}" sur un concept pas encore appris.
${KIND_TUTOR}
1. Relève ce qui est juste/pertinent (même partiel)
2. Introduis le vrai concept naturellement
3. Éclaire la différence si sa réponse s'éloignait
Concept: ${notion}
Explication: ${explication}
3-5 phrases, français.`,

  reformAck: (ue: string) => `Tuteur DCG ${ue}. L'étudiant reformule un concept dans ses mots — une phrase courte suffit et c'est très bien.
${KIND_TUTOR}
En 1-2 phrases: confirme le juste, complète doucement si besoin. Français.`,

  socrate: (ue: string, contenu: string, weak: string | null, priorCompteRendu?: string | null) => `Maître socratique DCG ${ue}. JAMAIS la réponse directement. Questions progressives.
${KIND_TUTOR}
Contenu: ${contenu}
${priorCompteRendu ? `NOTE DE LA SESSION PRÉCÉDENTE SUR CE CHAPITRE : ${priorCompteRendu}\nPriorise ces points AVANT toute autre chose.` : ""}
${weak ? `PRIORITÉ ABSOLUE — lacunes identifiées sur: ${weak}. Concentre tes questions dessus en premier.` : !priorCompteRendu ? "Approfondis les concepts les plus importants." : ""}
1 question à la fois, exemples concrets, français, 3-5 phrases max.`,

  exo: (ue: string, diff: string, story: any | null, priorCompteRendu?: string | null) => `Concepteur sujets DCG ${ue}. UN sujet type annales niveau ${diff} en dossiers.
${story ? `IMPORTANT: le sujet se déroule dans la MÊME entreprise: ${story.entreprise}, avec ${story.personnage}. L'étudiant connaît ce contexte — fais évoluer la situation (nouveaux événements, nouvelles données chiffrées).` : ""}
${priorCompteRendu ? `NOTE DE LA SESSION PRÉCÉDENTE SUR CE CHAPITRE : ${priorCompteRendu}\nFais porter au moins un dossier sur ces points faibles.` : ""}
JSON pur:
{"titre":"...","contexte":"Situation, données chiffrées...","dossiers":[{"numero":1,"titre":"...","points":0,"questions":[{"numero":1,"enonce":"...","points":0}]}],"total_points":20}
IMPORTANT: réponds UNIQUEMENT avec le JSON.`,

  corrJSON: (ue: string, ex: string) => `Correcteur DCG ${ue}. Corrige la copie de l'étudiant sur cet exercice:
${ex}
${KIND_TUTOR}
Pour CHAQUE question, dans "evaluation": commence par les points forts, puis ce qui manque, formulé comme piste de progrès. JSON pur:
{"corrections":[{"dossier":1,"question":1,"note":0,"bareme":0,"evaluation":"Points forts puis pistes, 2-3 phrases","reponse_attendue":"La réponse complète attendue"}],"total":0,"appreciation":"Appréciation globale encourageante, 2-3 phrases"}
IMPORTANT: réponds UNIQUEMENT avec le JSON.`,

  corrChat: (ue: string, ex: string) => `Correcteur DCG ${ue} qui vient de corriger cette copie: ${ex}
${KIND_TUTOR}
L'étudiant pose des questions sur ta correction. Réponds précisément, en français.`,

  recallCheck: (ue: string, notion: string, cle: string) => `Tuteur DCG ${ue}. L'étudiant répond à une question de rappel. La bonne réponse concerne : "${notion}" — ${cle}.
${KIND_TUTOR}
En 1-2 phrases : relève le juste, complète si besoin. Français, concis.`,

  compteRendu: (ue: string) => `Tuteur DCG ${ue}. Rédige un compte-rendu compact (4-6 phrases) de cette session d'étude, qui sera relu par toi-même — pas par l'étudiant — lors de la PROCHAINE session de révision sur ce chapitre, pour savoir quoi cibler.
Base-toi UNIQUEMENT sur les données fournies, ne rien inventer. Couvre, dans cet ordre :
1. Les notions précises où des difficultés ou confusions récurrentes sont apparues (sois spécifique — nomme les notions, pas de généralités comme "quelques lacunes").
2. Les points visiblement solides, à ne pas re-tester inutilement.
3. Une priorité claire pour la prochaine session.
Ton factuel et clair, sans dramatiser ni minimiser — c'est une note technique de suivi, pas un message d'encouragement.
Réponds uniquement avec le texte du compte-rendu, sans titre, sans markdown.`,
};

export const DIFFS = ["Fondamental", "Intermédiaire", "Annales"] as const;
export type Diff = (typeof DIFFS)[number];
export const bumpDiff = (d: string): Diff => {
  const i = DIFFS.indexOf(d as Diff);
  return DIFFS[Math.min(i + 1, DIFFS.length - 1)];
};

export const RECALL_EVERY = 3;
export const MAX_CHAT = 20;
