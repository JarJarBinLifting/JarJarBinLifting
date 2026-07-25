# Questions de confusion dans une leçon DCG

Une question de QCM peut porter une paire de notions à comparer. Ce champ est
optionnel : les fichiers de leçon existants restent valides.

```json
{
  "question": "Une opération est-elle de la TVA collectée ou de la TVA déductible ?",
  "theme": "TVA",
  "options": ["...", "...", "...", "..."],
  "correct": 0,
  "explication": "...",
  "option_feedbacks": ["...", "...", "...", "..."],
  "confusion": {
    "notion_a": "TVA collectée",
    "notion_b": "TVA déductible",
    "distinction": "La TVA collectée est encaissée pour le compte de l'État ; la TVA déductible est récupérable sous conditions sur les achats."
  }
}
```

Le QCM affiche alors la paire avant la réponse, insère ces questions entre les
questions standards quand c'est possible, et ajoute la distinction au feedback.
Pour chaque chapitre, déclarer au moins trois confusions réellement présentes
dans le support fourni ; ne jamais inventer une règle ou une exception.
