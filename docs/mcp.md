# Utiliser Confluent depuis Claude ou ChatGPT (MCP)

Confluent expose un **serveur MCP distant** : un assistant IA connecté lit vos dossiers et enregistre vos réponses, avec exactement vos droits. La connexion passe par OAuth : vous vous connectez à Confluent avec votre lien habituel par email et vous choisissez les permissions accordées.

- **Adresse du connecteur** : `https://<API publique>/mcp` (en production `https://api.confluent.network/mcp`). Elle est affichée et copiable dans le site, menu **Applications IA**.
- **Permissions** : `dossiers:read` (lire votre profil, vos dossiers, leurs questionnaires et réponses) et `dossiers:write` (modifier les réponses de vos dossiers ; inclut la lecture).
- **Révocation** : menu **Applications IA** → **Révoquer**. Effet immédiat : l'assistant reçoit un refus à son appel suivant.

## Claude (claude.ai, Claude Desktop)

Disponible sur les offres Free (un seul connecteur personnalisé), Pro, Max, Team et Enterprise. En Team/Enterprise, un **Owner** ajoute d'abord le connecteur pour l'organisation (Organization settings → Connectors → Add → Custom → Web), puis chaque membre clique **Connect**.

1. **Customize → Connectors** (claude.ai/customize/connectors) → **+ Add** → **Add custom connector**.
2. Nom : `Confluent`. URL : l'adresse du connecteur. **Continue**.
3. Authentification : **Sign in now**. Client OAuth : **Use Claude's published identity (Recommended)** — Confluent reconnaît l'identité publiée de Claude (Client ID Metadata Document). **Add**.
4. Vous arrivez sur Confluent : connectez-vous par email si besoin, choisissez les permissions, **Autoriser**. Vous revenez dans Claude.
5. Dans une conversation : **+** → **Connectors** → activez **Confluent**. Exemple : « Liste mes dossiers Confluent et dis-moi ce qu'il manque dans Biosensio ».

Claude demande votre accord avant chaque outil d'écriture (`create_dossier`, `update_answers`). Pour retirer le connecteur : Customize → Connectors → **Remove**. Les réglages d'authentification ne se modifient pas : retirez puis ajoutez de nouveau.

## ChatGPT (web)

Les droits de l'espace de travail ChatGPT s'appliquent (un administrateur peut restreindre les connecteurs personnalisés).

1. Ouvrez chatgpt.com/plugins → **+** → **Add custom MCP server**.
2. Nom : `Confluent`. **Server URL** : l'adresse du connecteur. Authentification : **OAuth**.
3. Acceptez l'avertissement (**I understand and want to continue**), puis **Create as a plugin**, et installez-le.
4. Connectez-vous à Confluent quand ChatGPT vous y envoie, choisissez les permissions, **Autoriser**.
5. Dans une conversation : tapez **@** et choisissez **Confluent**.

ChatGPT demande confirmation pour les outils d'écriture. Si la connexion échoue avec la méthode « Client ID Metadata Document », choisissez l'enregistrement automatique (DCR) : Confluent accepte les clients publics CIMD (`token_endpoint_auth_method: none`) mais pas encore `private_key_jwt`.

## Outils disponibles

| Outil | Permission | Ce qu'il fait |
|---|---|---|
| `whoami` | lecture | Compte connecté, rôle, permissions accordées |
| `list_dossiers` | lecture | Vos dossiers (et pour un financeur, ceux qui vous sont partagés) |
| `get_dossier` | lecture | Formulaire et version du dossier ; questions par section avec format attendu, contraintes, choix, réponse actuelle (documents pour une pièce jointe) ; permissions (niveau d'accès, modification possible ou non et pourquoi) ; complétion globale et par section ; champs obligatoires manquants |
| `get_form` | lecture | Définition d'un formulaire sans réponses : celui des nouveaux dossiers pour un porteur de projet ; tout formulaire et toute version, brouillon compris avec ses problèmes de publication, pour un administrateur. Refusé aux financeurs |
| `list_forms` | lecture | Administrateurs : formulaires, usage, archivage et versions |
| `next_questions` | lecture | Propriétaire : prochaines questions sans réponse dans l'ordre du formulaire (avec format attendu, contraintes, aide), complétion, nombre restant et lien vers le même dossier dans le site ; `after` pour continuer après une question passée |
| `create_dossier` | écriture | Crée un dossier avec le formulaire publié des nouveaux dossiers et renvoie ses premières questions ; refusé si un brouillon du même nom existe (sauf confirmation `allowDuplicate`) ; porteurs de projet uniquement |
| `update_answers` | écriture | Enregistre des réponses (propriétaire uniquement ; valeurs vérifiées, rien n'est écrit si une valeur est invalide) ; renvoie la complétion et la question suivante |

**Remplir un dossier en conversation.** L'assistant reprend le brouillon existant (`list_dossiers` indique `brouillon` ou `soumis`), demande à `next_questions` les questions restantes, les pose une à une et enregistre chaque réponse dès qu'elle est donnée. Rien n'est perdu si la conversation s'arrête : une autre conversation, ou le site, reprend le même dossier là où il en est. Une question passée n'est pas mémorisée : elle sera reproposée plus tard. Les pièces jointes se déposent et le dossier se soumet encore dans le site.

Chaque appel est inscrit au journal (utilisateur, application, outil, cible, résultat).

## Pour l'exploitation

- `API_PUBLIC_URL` (API) doit valoir l'URL HTTPS publique exacte de l'API, et `VITE_API_URL` (web) la même valeur : c'est l'émetteur OAuth et la base de l'adresse `/mcp`.
- L'API doit être joignable depuis Internet par les serveurs de Claude (plage de sortie Anthropic `160.79.104.0/21`) et d'OpenAI ; aucune liste blanche IP n'est nécessaire sur `api.confluent.network`.
- Points de contrôle : `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-authorization-server`, `POST /mcp` sans jeton → `401` avec `WWW-Authenticate: Bearer resource_metadata="…"`.
- Retours OAuth acceptés : HTTPS ou loopback (`http://localhost:<port>`, utilisé par Claude Code et les inspecteurs MCP).

## Recette E01.09 (à exécuter dans chaque client)

Connexion → `whoami` → `get_dossier` → `update_answers` sur un champ de test → réponse visible dans le site → reconnexion → révocation dans le site → appel suivant refusé. Essais négatifs : dossier d'un autre compte (introuvable), connexion en lecture seule puis écriture (permission demandée).
