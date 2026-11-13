# Exploitation de Confluent

Guide de l'opérateur d'une installation Confluent : installer, configurer, créer le premier administrateur, appliquer les migrations, réagir à un incident et ouvrir un workspace. Les commandes sont à copier telles quelles ; les valeurs `example.org` et `change-me…` sont à remplacer.

| Étape | Document |
|---|---|
| 1. Installer (images publiées ou sources) | [installation.md](installation.md) |
| 2. Configurer l'API et le site | [configuration.md](configuration.md) |
| 3. Appliquer les migrations, puis déployer une nouvelle version | [migrations.md](migrations.md) |
| 4. Créer le premier administrateur | [premier-admin.md](premier-admin.md) |
| 5. Ouvrir un workspace (structure) et sa page publique | [workspaces.md](workspaces.md) |
| En cas de problème | [incidents.md](incidents.md) |

Guides techniques existants, auxquels ces pages renvoient au lieu de les recopier :

- [deploiement.md](../deploiement.md) — secrets à l'exécution (Doppler), comptes PostgreSQL séparés, stockage S3, indexation, fichiers Compose ;
- [database-migrations.md](../database-migrations.md) — Prisma en développement et en production ;
- [development.md](../development.md) — poste de développement ;
- [api-documentation.md](../api-documentation.md) — Swagger et jetons de test ;
- [mcp.md](../mcp.md) — serveur MCP, permissions et outils des applications IA.

**Sauvegardes et restauration :** hors du périmètre de ce guide. Leur choix, leur activation et la recette de restauration sont reportés en fin de projet (épique E11, décision D09) ; aucune sauvegarde hors serveur n'est aujourd'hui déclarée configurée ni validée. Le mécanisme déjà écrit est décrit dans [deploiement.md](../deploiement.md) sans être validé.
