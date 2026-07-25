# Journal de session — 24 juillet 2026

## État de départ

### Ce qui tourne

- `npm run lint` réussit. Il signale six avertissements `react/only-export-components` dans `src/lib/theme.tsx` et `src/state/AppState.tsx`, sans erreur.
- `npm run build` réussit : le client React est produit dans `dist/`.
- `cargo test --manifest-path server/Cargo.toml` réussit : **49 tests passants**, aucun échec.
- `npm run server:build` réussit : le binaire de production intègre le frontend compilé.
- Le binaire de production a été démarré sur le port isolé `4288` et a répondu `HTTP 200` à `GET /api/settings/local-config`. La base SQLite locale est bien ouverte. Le processus de vérification a ensuite été fermé.

### Ce qui casse

- Aucun test ni build rouge au départ.
- Git, dans l'environnement de travail, considère le dépôt parent comme appartenant à un autre compte Windows (`dubious ownership`). Les commandes de lecture sont exécutées avec une exception ponctuelle `safe.directory`; aucune configuration Git globale n'est modifiée.

### Architecture comprise

- Application mono-poste : un serveur Rust/Axum écoute uniquement sur `127.0.0.1:4287`, sert le frontend React compilé et expose les routes JSON sous `/api`.
- Les données sont conservées localement dans SQLite. Les migrations `0001` à `0010` sont idempotentes et la base est sauvegardable/restaurable localement.
- Le frontend React/Vite organise le programme, l'agenda, le tutorat, les annales et le pilotage. L'état partagé et l'accès HTTP sont centralisés dans `src/state/AppState.tsx` et `src/lib/api.ts`.
- Les leçons sont importées comme JSON produits par un LLM : les sessions hors-ligne réutilisent histoire, flashcards et QCM sans appel d'API. La bibliothèque conserve des versions immuables des leçons.
- La répétition espacée actuelle est un système **Leitner** explicite, appliqué aux chapitres, flashcards et QCM. Le tutorat comprend déjà du rappel actif dans la découverte et un tri des flashcards selon la confiance, mais le suivi est majoritairement par chapitre/carte plutôt que par notion transverse.

### Périmètre reçu

Les tâches prioritaires sont littéralement renseignées comme `[tâche 1]`, `[tâche 2]` et `[tâche 3]`, sans contenu. Aucun travail produit ne sera inventé à leur place. Les tâches devront être précisées avant toute implémentation et tout commit de fonctionnalité.

### Dépendances et données

- Aucune dépendance ajoutée.
- Aucune migration ni suppression de données effectuée.
- Le répertoire de travail contenait déjà de nombreuses modifications non commitées ; elles sont préservées telles quelles.

## Ce qui est fait et testé

- État des lieux documenté avant toute modification produit.
- Lint front : réussi avec six avertissements préexistants non bloquants.
- Build front : réussi.
- Tests Rust : 49 réussites sur 49.
- Build du binaire de production : réussi.
- Démarrage réel : réussi ; API locale répondante avec la base ouverte.
- Aucun changement de dépendance, de schéma ou de données. Aucun commit créé : aucune des trois tâches produit n'était définie ni terminée.

## Ce qui est commencé et où j'en suis

- Aucun développement produit démarré volontairement : les trois entrées de priorité ne donnent pas de fonctionnalité à livrer.

## Décisions à valider

- Fournir le contenu concret de `[tâche 1]`, `[tâche 2]` et `[tâche 3]`. Elles sont actuellement des marqueurs vides.

## Ce que j'aurais fait ensuite

1. Traiter `[tâche 1]` strictement dans le périmètre donné, en le reliant explicitement à l'un des cinq principes d'apprentissage demandés.
2. Ajouter des tests ciblés, valider lint/build/tests et démarrage réel, puis créer un commit explicite pour cette seule tâche.
3. Reprendre avec `[tâche 2]`, puis `[tâche 3]` selon la même séquence.

## Surprises rencontrées

- Le seul obstacle initial est l'avertissement Git de propriété du dossier parent, qui n'affecte ni le build, ni les tests, ni le démarrage de l'application.

---

# Rapport final — mise à jour du 24 juillet 2026

## Ce qui est fait et testé

- **Tâche 1 — répétition espacée :** les flashcards utilisent désormais **SM-2**, choisi car son algorithme est explicite, éprouvé, compréhensible et ne réclame pas de données historiques massives comme FSRS. La migration `0011_flashcard_sm2.sql` conserve les données Leitner existantes et les initialise prudemment. Les boutons de révision envoient une note de qualité 0–5 ; les anciennes intégrations `correct: boolean` restent compatibles.
- **Tâche 2 — rappel actif, feedback et entrelacement :** une hypothèse écrite est obligatoire avant de révéler une flashcard ; les cartes dues sont alternées entre notions/chapitres quand un choix est possible ; les QCM peuvent afficher l'explication propre à chaque option, notamment pourquoi un distracteur est tentant. Le schéma de leçon importée et son prompt demandent désormais ces feedbacks.
- **Tâche 3 — progression par notion :** une route locale agrège la progression par `concept_id`, et l'écran Pilotage affiche les notions les plus fragiles : cartes stabilisées, répétitions SM-2, rappels dus/prochains rappels et exemple de question. Une moyenne de chapitre ne masque donc plus une notion fragile.
- Tests Rust : **54 réussites, 0 échec**. Lint front : réussi avec les six avertissements `react/only-export-components` préexistants et non bloquants. Build Vite et build du serveur de production : réussis.
- Démarrage réel vérifié sur le port isolé `4288` : `GET /api/tutor/flashcards/due` et `GET /api/tutor/concepts/progress` répondent `HTTP 200` ; la route de progression a bien renvoyé les groupes de notions de la base locale de vérification.
- Trois commits atomiques, chacun après validation : `a6475eb feat: schedule flashcards with SM-2`, `17d2a6d feat: deepen active recall and interleave reviews`, `d14daad feat: track progress by concept`.
- Aucune dépendance ajoutée. Aucune suppression ou migration destructive : la seule nouvelle migration ajoute des colonnes et préserve les échéances existantes.

## Ce qui est commencé et où j'en suis

- Rien de fonctionnel n'est laissé à moitié fait dans ce périmètre. Des modifications non commit déjà présentes au début de la session ont été conservées sans être amalgamées à ces trois commits.

## Décisions à valider

- Git n'avait pas d'identité locale utilisable : `user.name=Codex` et `user.email=codex@localhost` ont été configurés **dans ce dépôt uniquement** afin de respecter la règle d'un commit par tâche. Cette identité peut être remplacée par celle du propriétaire avant un push.
- SM-2 est le choix actif. Un passage futur à FSRS serait une évolution distincte : il faudrait disposer de suffisamment d'historique de révisions, définir ses paramètres et vérifier la migration des planifications existantes.

## Ce que j'aurais fait ensuite

1. Ajouter des libellés pédagogiques lisibles aux `concept_id` dans le JSON de leçon, afin que le tableau de notions affiche directement « TVA déductible » plutôt qu'un identifiant de notion.
2. Mesurer le taux de rappel et l'écart entre planifié/réalisé par notion avant d'envisager FSRS ; le choix doit être guidé par les données de l'étudiant.
3. Faire une session utilisateur complète (import d'une leçon, découverte, révision le lendemain) pour ajuster les consignes de rappel actif et la charge quotidienne à la réalité de préparation au DCG 2027.

## Surprises rencontrées

- Les trois tâches de la consigne initiale étaient des placeholders vides. Le périmètre a donc été dérivé explicitement des cinq contraintes d'apprentissage formulées par l'utilisateur : SM-2, rappel actif, feedback explicatif, entrelacement et suivi par notion.
- Le dépôt contenait déjà de nombreux changements non commités. Chaque commit a été construit en ne mettant en index que les hunks de cette session ; les modifications préexistantes restent intactes.

---

# Poursuite autonome — améliorations complémentaires

## Ce qui est fait et testé

- **Notions lisibles dans Pilotage :** le suivi de progression résout maintenant l'identifiant d'étape d'une flashcard vers le vrai intitulé de la notion de l'histoire (par exemple « TVA déductible »). Cela fonctionne aussi pour les cartes déjà importées, sans migration et sans réécriture de données. Commit : `468bbf4 feat: show meaningful concept labels`.
- **Feedback des distracteurs dans le Quiz éclair :** une question rejouée conserve désormais le feedback associé à chaque option. Après un mauvais choix, l'étudiant reçoit pourquoi ce choix était crédible puis la règle à retenir ; les anciennes questions gardent leur explication générique. La migration `0012_quiz_option_feedback.sql` ajoute uniquement une colonne nullable. Commit : `4ef6393 feat: explain tempting quiz distractors`.
- Tests Rust : **56 réussites, 0 échec**. Lint et build du frontend : réussis avec les six avertissements préexistants non bloquants. Build du serveur de production : réussi.
- Démarrage réel : le binaire de production a ouvert la base locale Windows et `GET /api/tutor/quiz/due` a répondu `HTTP 200` sur un port isolé.

## Décisions à valider

- Le Quiz éclair n'envoie le feedback détaillé qu'après la réponse : le bon index ne quitte donc toujours pas le serveur avant l'engagement de l'étudiant.
- Lorsqu'une même question est ratée à nouveau, sa version la plus récente remplace les options, la bonne réponse, l'explication et les feedbacks associés afin qu'ils restent cohérents entre eux.

---

# Poursuite autonome - QCM et repetition espacee

## Ce qui est fait et teste

- **Quiz eclair passe a SM-2 :** chaque QCM conserve maintenant son nombre de repetitions, son intervalle et son facteur de facilite. La bonne reponse est evaluee a la qualite **4/5** (rappel solide mais facilite par les options) ; une erreur vaut **1/5** et revient le lendemain. Les deux premieres reussites ouvrent les intervalles standards SM-2 de 1 puis 6 jours.
- Les QCM dus sont priorises par repetitions et facilite SM-2 pour faire revenir en premier les notions encore peu consolidees. L'ecran explique explicitement que cet espacement est calcule par SM-2.
- La migration `0013_quiz_sm2.sql` ajoute les trois colonnes SM-2 et initialise prudemment les cartes existantes depuis leur niveau Leitner ; aucune echeance, reponse ni historique n'est supprime.
- Tests Rust : **56 reussites, 0 echec**. Lint frontend : reussi avec les six avertissements `react/only-export-components` preexistants. Builds frontend et serveur : reussis.
- Demarrage reel : le binaire de production a ouvert la base locale et `GET /api/tutor/quiz/due` a repondu `HTTP 200` sur un port isole.
- Commit : `57cc5b2 feat: schedule quiz reviews with SM-2`. Aucune dependance ajoutee.

## Decisions a valider

- Le barème 4/5 pour une bonne reponse au QCM est volontairement plus prudent qu'un rappel ecrit entierement libre : cela evite d'espacer trop vite une reponse simplement reconnue.

## Ce que j'aurais fait ensuite

1. Afficher la date et l'intervalle de la prochaine reprise dans le resultat du QCM, pour rendre le plan de travail encore plus concret.
2. Quand assez d'historique individuel sera disponible, comparer les taux de rappel observes aux estimations SM-2 avant d'envisager FSRS.

---

# Correctif de surete - migrations locales

## Ce qui est fait et teste

- Le moteur de migrations ne se fie plus au plus grand numero applique : il verifie maintenant chaque migration individuellement. Une migration plus ancienne absente peut donc etre appliquee lors d'un lancement ulterieur, meme si une migration plus recente a deja ete enregistree.
- Un test de regression autonome reproduit une sequence de migrations avec une version intermediaire manquante apres une version plus recente, puis verifie que le schema attendu est bien recupere. Cela protege les bases locales existantes sans supprimer ni reconstruire de donnees.
- Tests Rust : **57 reussites, 0 echec**. Build du serveur de production et demarrage reel reussis ; `GET /api/tutor/quiz/due` repond `HTTP 200`.
- Commits : `4e26e0c fix: apply missing migrations safely` et `d98c59f test: make migration gap coverage self-contained`. Aucune dependance ajoutee.

---

# Poursuite autonome - rendre SM-2 actionnable

## Ce qui est fait et teste

- Apres chaque reponse du Quiz eclair, l'etudiant voit maintenant sa prochaine reprise en langage clair : `aujourd'hui`, `demain` ou la date complete. Le message relie explicitement cette echeance a l'espacement SM-2 apres une reussite, ou a la consolidation rapide apres une erreur.
- La date transmise par l'API est interpretee comme une date de calendrier locale afin d'eviter un decalage de jour lie au fuseau horaire du navigateur.
- Lint frontend, build frontend, **57 tests Rust**, build serveur et demarrage reel sont reussis. L'endpoint `GET /api/tutor/quiz/due` a repondu `HTTP 200`.
- Commit : `dbc6af2 feat: show quiz review timing`. Aucune dependance ni migration ajoutee.

---

# Poursuite autonome - plan quotidien par notion fragile

## Ce qui est fait et teste

- La Revision eclair construit maintenant un plan avant d'afficher la premiere carte. Elle cible d'abord la notion due la moins consolidee, puis place une carte d'une notion differente en deuxieme position. Lorsqu'il existe une autre notion due dans le meme chapitre, elle est choisie en premier pour comparer des regles proches ; sinon l'alternance utilise une autre notion due.
- Le plan affiche les deux notions choisies et explique la raison de l'alternance. Le reste du paquet conserve l'entrelacement serveur existant. Si la lecture de progression echoue temporairement, la revision reste disponible avec le paquet SM-2 normal.
- Lint frontend, build frontend, **57 tests Rust**, build serveur et demarrage reel sont reussis. `GET /api/tutor/concepts/progress` a repondu `HTTP 200` et a retourne 22 notions sur la base locale de verification.
- Commit : `4f4d566 feat: target daily reviews by concept`. Aucune dependance ni migration ajoutee.

## Decisions a valider

- La proximite entre notions est actuellement approximee par le meme chapitre, car les lecons JSON ne portent pas encore de liens explicites de confusion. Ajouter plus tard un champ optionnel de notions souvent confondues permettrait un entrelacement encore plus precis sans changer les cartes existantes.

---

# Poursuite autonome - mode confusions frequentes (premiere brique)

## Ce qui est fait et teste

- Avant la revision de deux notions distinctes selectionnees dans le meme chapitre, l'app demande maintenant une comparaison ecrite : l'etudiant formule la difference decisive avant de voir les deux regles cote a cote. Cette question comparative est construite localement a partir des flashcards existantes, sans appel LLM ni nouvelle donnee.
- La reprise ciblee ne commence qu'apres cette exposition. Le QCM de la lecon conserve ensuite ses distracteurs et feedbacks par option, deja demandes par le prompt d'import ; le rappel actif et le feedback explicatif sont donc lies dans un meme flux.
- Lint frontend, build frontend, **57 tests Rust**, build serveur et demarrage reel sont reussis. `GET /api/tutor/concepts/progress` a repondu `HTTP 200` avec 22 notions sur la base locale de verification.
- Commit : `d534480 feat: add active comparison review`. Aucune dependance ni migration ajoutee.

## Decisions a valider

- Cette premiere version choisit les paires a comparer parmi les notions dues du meme chapitre, car le schema JSON actuel ne transporte pas encore de paires de confusion declarees. L'etape suivante sera d'ajouter un champ optionnel `confusions_frequentes` au fichier de lecon et au prompt d'import, afin de choisir les paires pedagogiquement exactes plutot que de se fier a la proximite de chapitre.

---

# Poursuite autonome - contrat JSON des confusions

## Ce qui est fait et teste

- Les questions QCM importees peuvent maintenant declarer, de facon optionnelle, une paire `confusion` avec `notion_a`, `notion_b` et `distinction`. Les fichiers existants restent valides sans ce champ.
- Une question annotee affiche les deux notions avant la reponse, est intercalee avec les questions standards lorsqu'elles coexistent, puis ajoute la distinction cle au feedback de chaque choix. Cela rend le distracteur explicite et evite de regrouper les questions de comparaison.
- Le format et un exemple complet sont documentes dans `docs/lesson-confusions.md` afin de pouvoir les ajouter aux prochaines lecons JSON sans changer les lecons deja importees.
- Lint frontend, build frontend, **57 tests Rust**, build serveur et demarrage reel sont reussis. `GET /api/tutor/concepts/progress` a repondu `HTTP 200` avec 22 notions sur la base locale de verification.
- Commit : `e9e7000 feat: support explicit lesson confusions`. Aucune dependance ni migration ajoutee.

## Decisions a valider

- Le format accepte aussi les alias `confusion_frequente`, `notionA`, `notionB` et `distinction_cle` lors de la lecture, pour tolerer les sorties de plusieurs LLM. Le format a produire reste volontairement le plus simple : `confusion.notion_a`, `confusion.notion_b`, `confusion.distinction`.

---

# Rapport final — poursuite du 25 juillet 2026

## Ce qui est fait et testé

- **Import des confusions (entrelacement et feedback explicatif) :** le prompt d'import est passé à la version 4. Il exige au moins trois questions de discrimination avec le champ `confusion` (`notion_a`, `notion_b`, `distinction`). L'import valide ce format lorsqu'il est présent et avertit lorsqu'une leçon en contient moins de trois. Les fichiers plus anciens restent acceptés.
- **Annales vers révisions ciblées :** une réponse qui obtient moins de 50 % du barème sauvegarde maintenant la réponse réellement écrite, le corrigé attendu et un diagnostic contrôlé (connaissance, méthode, calcul, lecture ou temps). Elle crée toujours une carte de révision SM-2 liée au carnet d'erreurs. Commit : `d4c61d1 feat: target annale error reviews`.
- **Calibration confiance / rappel actif :** le bilan confronte l'estimation préalable (échelle 1–3 rendue explicite) au pourcentage réellement obtenu au QCM. Il signale une confiance réaliste, à ajuster ou prudente ; l'écart de plus de 15 points est le seuil retenu. Commit : `e23a04e feat: show confidence calibration`.
- **Trajectoire DCG par UE :** chaque UE dispose d'une couverture, d'un score QCM mesuré, d'un statut de rythme et de la prochaine action recommandée jusqu'au 30 mai 2027. La couverture est cadencée du 1er juillet au 31 décembre 2026 pour réserver janvier à mai à la consolidation et aux annales. Commit : `5fd104d feat: plan trajectory for each UE`.
- Tests ciblés Annales : 4 réussites. Tests Rust complets : **59 réussites, 0 échec**. Lint et build frontend réussis ; les six avertissements Fast Refresh préexistants restent non bloquants. Build du serveur de production réussi (deux avertissements préexistants sur l'ancien planificateur Leitner inutilisé).
- Démarrage réel vérifié sur le port isolé `4305` : l'interface `/`, la configuration locale et `/api/annales` ont toutes répondu `HTTP 200`.
- Aucune dépendance ajoutée, aucune migration ajoutée et aucune donnée existante supprimée.

## Ce qui est commencé et où j'en suis

- Rien n'est fonctionnellement à moitié implémenté. Les changements d'import v4 et le branchement de la trajectoire dans l'écran Programme sont actifs dans l'espace de travail courant et passent le build.

## Décisions à valider

- Les fichiers `lesson.ts`, `types.ts` et `Programme.tsx` faisaient partie de modifications non suivies déjà présentes. Leurs ajouts directement nécessaires (prompt v4, typage `confusion`, branchement de la trajectoire) sont volontairement restés hors des commits afin de ne pas amalgamer le travail existant. Ils sont bien présents et compilés dans l'espace de travail actuel.
- La conversion confiance → pourcentage est volontairement transparente (1 = 33 %, 2 = 67 %, 3 = 100 %) et le seuil de calibration est de 15 points. Le conserver ou l'ajuster après quelques vraies sessions utilisateur est une décision produit à prendre avec des données réelles.

## Ce que j'aurais fait ensuite

1. Ajouter un petit historique de calibration par UE pour vérifier si l'écart confiance/rappel se réduit réellement.
2. Faire apparaître la prochaine annale recommandée dans la trajectoire des UE une fois que plusieurs résultats d'annales existent.
3. Ajouter les paires de confusion aux flashcards importées, afin que les comparaisons actives ne dépendent plus seulement des questions QCM.

## Surprises rencontrées

- Un premier contrôle HTTP avec `Invoke-WebRequest` a échoué à cause d'une exception PowerShell locale ; la même vérification avec `curl.exe` a confirmé les trois réponses `HTTP 200`.
- Le dépôt contient toujours de nombreuses modifications utilisateur non commit ; chaque commit créé ici ne contient que les fichiers propres à l'amélioration concernée.

---

# Rapport final — boucle « préparation examen » du 25 juillet 2026

## Ce qui est fait et testé

- **Annales réellement actionnables :** toute réponse à moins de 50 % crée désormais, en plus de la note d’erreur et de la carte libre, un mini-QCM lié au chapitre. Il reprend la réponse réellement donnée comme distracteur, explique précisément la perte de points, fournit la règle/correction attendue et repart au début de l’algorithme SM-2. Commit : `e12885b feat: schedule annale recovery plans`.
- **Contrôle qualité des leçons JSON :** l’import analyse maintenant le rattachement UE/chapitre, les notions oubliées par étape, les contradictions entre flashcards, les doublons de QCM, les distracteurs sans véritable feedback et les justifications insuffisantes. Les incohérences bloquantes empêchent l’import ; les limites non certaines sont affichées comme avertissements. Commit : `9136b97 feat: audit imported lesson quality`.
- **Carte de risque par notion :** Pilotage affiche un statut **fragile**, **en consolidation** ou **fiable**, fondé sur le rappel sans aide (cartes maîtrisées), la stabilité SM-2, les erreurs liées des 21 derniers jours, la dernière exposition et les révisions dues. Commit : `7387758 feat: assess exam readiness by concept`.
- **Simulations adaptatives :** le tableau de bord lance une simulation de 12 minutes à partir des notions les plus faibles et du contenu personnel importé. Chaque item demande une rédaction, un calcul/vérification ou une application avant de révéler le corrigé ; l’auto-évaluation programme ensuite la carte avec SM-2. Commit : `0d2fcba feat: add adaptive exam simulations`.
- Validation finale : `cargo fmt --check`, **59 tests Rust** (0 échec), lint et build client, build serveur de production, puis démarrage réel. `/`, `/api/tutor/concepts/progress` et `/api/annales` ont répondu `HTTP 200` sur le port isolé `4306`.
- Aucune dépendance et aucune migration destructive n’ont été ajoutées.

## Ce qui est commencé et où j’en suis

- Rien n’est à moitié implémenté sur ces quatre chantiers. Les branchements visuels nécessaires sont actifs dans l’espace de travail courant et passent le build.

## Décisions à valider

- Le rappel « sans aide » est mesuré par les cartes maîtrisées, car le flux Flashcards impose déjà une réponse tapée avant révélation. C’est un indicateur volontairement simple et lisible ; il pourra être enrichi par un historique d’essais quand des données réelles seront disponibles.
- Le contrôle de cohérence est volontairement conservateur : il peut vérifier la structure, les contradictions internes et le rattachement fourni, mais ne prétend pas établir la véracité factuelle d’un texte de source par un LLM.
- Les simulations n’inventent pas de cas DCG : elles réemploient le contenu JSON importé et demandent une réponse libre, puis une auto-évaluation SM-2. Ce choix est réversible et évite de fabriquer du contenu de cours non validé.
- Plusieurs fichiers d’intégration étaient déjà modifiés ou non suivis avant cette boucle. Ils n’ont pas été ajoutés aux commits pour ne pas mélanger le travail existant, mais la version actuelle de l’application les utilise et les validations ci-dessus les couvrent.

## Ce que j’aurais fait ensuite

1. Faire appliquer le même audit de leçon côté serveur aux clients qui contourneraient l’écran d’import.
2. Ajouter une grille de correction par compétence aux simulations de rédaction et de calcul, sans simuler une correction automatique non fiable.
3. Mesurer, par UE, l’effet réel des plans de reprise d’annale sur les scores des sessions suivantes.

## Surprises rencontrées

- Les requêtes de planification déjà présentes classaient utilement les notions faibles ; la simulation a pu s’y raccorder sans nouvelle dépendance ni nouvelle table.
- Le dépôt garde des modifications utilisateur non commit. Chaque commit de cette livraison isole seulement le fichier nouveau et testé correspondant à la tâche concernée.
