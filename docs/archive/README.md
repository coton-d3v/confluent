# Archives de documentation

Ces documents sont conservés pour retrouver les décisions, le comparatif Moneyplace, les maquettes et l'historique des livraisons. **Ils ne constituent plus un plan de travail actif.**

La référence courante est [la roadmap Confluent](../ROADMAP.md). Toute nouvelle tâche, priorité ou décision produit doit y être rattachée.

## Archivage du 8 novembre 2026

| Ancien emplacement | Archive | Motif |
|---|---|---|
| `docs/cadrage-v1-confluent-moneyplace.md` | [Comparatif et arbitrages Confluent × Moneyplace](2026-11-08/cadrage-v1-confluent-moneyplace.md) | Décisions utiles reprises ; état du code et ordre des jalons devenus obsolètes |
| `docs/cahier-des-charges.md` | [Ancien cahier des charges](2026-11-08/cahier-des-charges.md) | Doublons et affirmations de fonctionnalités livrées qui ne correspondent pas toutes au code |
| `_bmad-output/planning-artifacts/` | [Planification BMAD historique](2026-11-08/bmad-output/planning-artifacts/) | PRD, architecture, anciennes épiques, spécification UX et maquettes conservés comme références |
| `_bmad-output/implementation-artifacts/` | [Fiches de livraison et ancien suivi](2026-11-08/bmad-output/implementation-artifacts/) | Statuts et dettes regroupés ; ne pas poursuivre le suivi dans `sprint-status.yaml` ou `deferred-work.md` |

**60 fichiers ont été déplacés, aucun contenu fonctionnel supprimé.** Les liens Markdown vers les fichiers encore présents ont été adaptés à leur nouvel emplacement. Les blocs de code, arborescences et chemins cités dans le texte restent des traces historiques : ils peuvent désigner une ancienne version du dépôt.

## Comment lire les archives

- Une case « done » peut désigner une interface mockée ou une ancienne livraison ; vérifier l'état courant dans la roadmap et le code.
- Les propositions aux questions N1 à N7 / QV ne sont pas toutes des décisions validées. Les arbitrages ouverts ont été repris dans la roadmap.
- L'architecture historique décrit notamment des versions de bibliothèques, modèles d'authentification et formats de réponse qui ne correspondent plus tous à l'application.
- Les reports portant sur du code supprimé ne sont pas réintroduits automatiquement : le backlog courant regroupe les résultats encore pertinents.
- Pour retrouver un document, utiliser son chemin ci-dessus ; ne pas le rétablir comme deuxième source de priorités.

Les guides [développement](../development.md), [base et migrations](../database-migrations.md) et [API](../api-documentation.md) restent des procédures techniques actives. Ils ne portent plus de roadmap produit.
