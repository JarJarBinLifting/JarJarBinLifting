# Mini-exercices de simulation DCG

Le format `dcg-lecon.json` accepte désormais un champ optionnel `exercices`.
Les anciennes leçons restent valides, mais elles ne peuvent pas alimenter les
simulations de rédaction, calcul et application tant qu'elles ne sont pas
réimportées avec le prompt v5.

```json
{
  "exercices": [
    {
      "titre": "Qualifier une opération de TVA",
      "format": "application",
      "duree_minutes": 8,
      "notions": ["TVA collectée", "TVA déductible"],
      "etapes": [2, 3],
      "enonce": "La société X vend puis achète les biens décrits dans le support.",
      "consigne": "Qualifie chaque opération et justifie le traitement de TVA.",
      "bareme": [
        {
          "critere": "Qualifier la TVA sur la vente",
          "points": 2,
          "attendu": "Identifier une TVA collectée et expliquer pourquoi.",
          "piege": "La confondre avec une TVA déductible parce que l'entreprise encaisse la taxe."
        },
        {
          "critere": "Justifier la déduction sur l'achat",
          "points": 2,
          "attendu": "Rappeler les conditions applicables prévues par le support.",
          "piege": "Déduire automatiquement toute TVA sans vérifier les conditions."
        }
      ],
      "corrige": "Présenter le raisonnement opération par opération, puis conclure sur le montant dû ou récupérable."
    }
  ]
}
```

Règles de qualité :

- 4 à 6 exercices par leçon, de 3 à 20 minutes chacun ;
- uniquement des notions réellement présentes dans le chapitre source ;
- au moins deux critères de barème avec leurs points, l'attendu et le piège ;
- une réponse rédigée, un calcul ou une application : jamais un QCM déguisé ;
- `etapes` est facultatif, mais relie l'exercice aux étapes de l'histoire et
  permet de reprogrammer la flashcard la plus pertinente avec SM-2.

La simulation demande d'abord une réponse sans aide. Elle révèle ensuite la
grille critère par critère, le corrigé, et programme une reprise SM-2 selon le
score auto-évalué. Le produit ne prétend donc pas corriger automatiquement une
copie rédigée.
