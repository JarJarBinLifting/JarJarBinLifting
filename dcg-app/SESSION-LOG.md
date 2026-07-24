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
