# Backlog produit

## Calibration historique par UE

Conserver l'écart confiance / rappel actif par session et par UE, puis montrer sa tendance.

Justification : le signal de calibration actuel est fiable pour une session, mais modifier les seuils ou en tirer un diagnostic durable sans historique créerait une fausse précision.

## Annale recommandée dans la trajectoire UE

Proposer la prochaine annale chronométrée quand une UE a assez de résultats comparables.

Justification : la trajectoire affiche déjà la priorité et la prochaine action. Une recommandation automatique de sujet doit attendre plusieurs annales et une règle de comparaison validée, pour ne pas pousser un sujet inadapté.

## Comparaisons actives depuis les flashcards

Associer les paires `confusion` importées aux flashcards afin de les demander aussi dans les révisions SM-2, pas uniquement dans les QCM.

Justification : cela renforcerait l'entrelacement des notions proches, mais demande de définir un lien de données durable entre le JSON de leçon et les cartes existantes sans migration destructive.

## Audit JSON côté serveur

Appliquer les contrôles de qualité de leçon aux imports qui arrivent directement par une API ou un futur client, pas seulement à l’écran d’import actuel.

Justification : l’audit client bloque déjà les incohérences avant import dans le parcours de l’application. Une règle serveur devient pertinente si d’autres chemins d’import sont exposés ; elle doit reprendre exactement les mêmes critères pour éviter deux sources de vérité.

## Grille de correction des simulations écrites

Associer chaque exercice de simulation à une grille par compétence (éléments attendus, calculs, pièges et temps cible) afin de rendre l’auto-évaluation plus guidée.

Justification : une simulation à réponse libre prépare le format DCG, mais une notation automatique sans contenu validé serait trompeuse. Une grille issue des annales et corrections validées est la prochaine étape sûre.
