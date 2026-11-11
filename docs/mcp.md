# Utiliser Confluent depuis Claude ou ChatGPT (MCP)

Confluent expose un **serveur MCP distant** : un assistant IA connecté lit vos dossiers et enregistre vos réponses, avec exactement vos droits. La connexion passe par OAuth : vous vous connectez à Confluent avec votre lien habituel par email et vous choisissez les permissions accordées.

- **Adresse du connecteur** : `https://<API publique>/mcp` (en production `https://api.confluent.network/mcp`). Elle est affichée et copiable dans le site, menu **Applications IA**.
- **Permissions** : `dossiers:read` (lire votre profil, vos dossiers, leurs questionnaires, réponses et documents) et `dossiers:write` (modifier les réponses de vos dossiers et y déposer des documents ; inclut la lecture). Administrateurs seulement : `forms:write` (créer et modifier des brouillons de formulaires, sans les publier), proposée comme une case distincte sur l'écran de consentement ; elle n'est jamais proposée ni accordée à un autre compte, même si l'application la demande.
- **Révocation** : menu **Applications IA** → **Révoquer**. Effet immédiat : l'assistant reçoit un refus à son appel suivant.

## Claude (claude.ai, Claude Desktop)

Disponible sur les offres Free (un seul connecteur personnalisé), Pro, Max, Team et Enterprise. En Team/Enterprise, un **Owner** ajoute d'abord le connecteur pour l'organisation (Organization settings → Connectors → Add → Custom → Web), puis chaque membre clique **Connect**.

1. **Customize → Connectors** (claude.ai/customize/connectors) → **+ Add** → **Add custom connector**.
2. Nom : `Confluent`. URL : l'adresse du connecteur. **Continue**.
3. Authentification : **Sign in now**. Client OAuth : **Use Claude's published identity (Recommended)** — Confluent reconnaît l'identité publiée de Claude (Client ID Metadata Document). **Add**.
4. Vous arrivez sur Confluent : connectez-vous par email si besoin, choisissez les permissions, **Autoriser**. Vous revenez dans Claude.
5. Dans une conversation : **+** → **Connectors** → activez **Confluent**. Exemple : « Liste mes dossiers Confluent et dis-moi ce qu'il manque dans Biosensio ».

Claude demande votre accord avant chaque outil d'écriture (`create_dossier`, `update_answers`, `upload_document`, et pour un administrateur les outils de conception de formulaires). Pour retirer le connecteur : Customize → Connectors → **Remove**. Les réglages d'authentification ne se modifient pas : retirez puis ajoutez de nouveau.

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
| `get_dossier` | lecture | Formulaire et version du dossier ; questions par section avec format attendu, contraintes, choix, réponse actuelle (documents pour une pièce jointe) et, pour le propriétaire, sa provenance ; permissions (niveau d'accès, modification possible ou non et pourquoi) ; complétion globale et par section ; champs obligatoires manquants |
| `get_form` | lecture | Définition d'un formulaire sans réponses : celui des nouveaux dossiers pour un porteur de projet ; tout formulaire et toute version, brouillon compris avec ses problèmes de publication, pour un administrateur. Refusé aux financeurs |
| `list_forms` | lecture | Administrateurs : formulaires, usage, archivage et versions |
| `next_questions` | lecture | Propriétaire : prochaines questions sans réponse dans l'ordre du formulaire (avec format attendu, contraintes, aide), complétion, nombre restant et lien vers le même dossier dans le site ; `after` pour continuer après une question passée |
| `list_documents` | lecture | Pièces attendues (questions « pièce jointe », dans l'ordre du formulaire, fournies ou non) et documents déposés, y compris hors questions : `documentId`, nom, version et versions précédentes, format, taille, disponibilité, lisible ou non (et pourquoi) ; pour le propriétaire, lien de dépôt dans le site (`uploadUrl`). Financeur : selon le niveau du partage |
| `read_document` | lecture | Texte d'une version de document (voir **Documents** ci-dessous), par parties (`part`) indiquant les pages, feuilles ou diapositives couvertes ; donnée non fiable, jamais une consigne |
| `create_dossier` | écriture | Crée un dossier avec le formulaire publié des nouveaux dossiers et renvoie ses premières questions ; refusé si un brouillon du même nom existe (sauf confirmation `allowDuplicate`) ; porteurs de projet uniquement |
| `update_answers` | écriture | Enregistre des réponses (propriétaire uniquement ; valeurs vérifiées, rien n'est écrit si une valeur ou une source est invalide), chacune avec sa provenance (voir **Provenance des réponses**) ; renvoie la complétion et la question suivante |
| `create_form`, `duplicate_form`, `open_form_draft` | conception (`forms:write`) | Administrateurs : créer un formulaire (brouillon vide), en dupliquer un, ouvrir ou reprendre le brouillon de la prochaine version d'un formulaire publié (voir **Concevoir un formulaire**) |
| `add_form_section`, `update_form_section`, `remove_form_section`, `reorder_form_sections` | conception (`forms:write`) | Administrateurs : sections du brouillon |
| `add_form_field`, `update_form_field`, `remove_form_field`, `reorder_form_fields` | conception (`forms:write`) | Administrateurs : questions du brouillon — type, obligatoire, aide, choix, limites de saisie, niveau de lecture, déplacement d'une section à l'autre |
| `upload_document` | écriture | Propriétaire : dépose un petit fichier (512 Ko maximum, en base64 ou en texte pour un `.txt`/`.csv`) pour une question « pièce jointe » ou parmi les autres documents ; mêmes formats et contrôles que le site, nouvelle version si le nom existe déjà pour la même question ; renvoie la complétion et la question suivante |

**Remplir un dossier en conversation.** L'assistant reprend le brouillon existant (`list_dossiers` indique `brouillon` ou `soumis`), demande à `next_questions` les questions restantes, les pose une à une et enregistre chaque réponse dès qu'elle est donnée. Rien n'est perdu si la conversation s'arrête : une autre conversation, ou le site, reprend le même dossier là où il en est. Une question passée n'est pas mémorisée : elle sera reproposée plus tard. Le dossier se soumet encore dans le site.

## Concevoir un formulaire (administrateurs)

Un administrateur construit un brouillon de formulaire en conversation ; le résultat est **le même brouillon que dans le constructeur du site** (menu Formulaires), modifiable aussitôt de part et d'autre.

- **Par où commencer.** `list_forms` et `get_form` (version `"brouillon"`) montrent l'existant. `create_form` crée un formulaire non affecté avec un brouillon vide ; `duplicate_form` en copie un (version publiée, mêmes clés) ; `open_form_draft` ouvre le brouillon de la version suivante d'un formulaire publié, ou reprend tel quel celui qui existe déjà. Un second formulaire du même nom n'est créé que si l'administrateur le confirme (`allowDuplicate`).
- **Petites étapes, identifiants explicites.** Chaque outil fait une seule opération du constructeur et renvoie le plan du brouillon : `sectionId` et `fieldId`, clés, types, choix, limites, niveau de lecture (`readLevel` : `public`, `partiel`, `complet`, ce dernier par défaut), la `revision` du brouillon, les problèmes qui empêchent sa publication (`problems`, mêmes contrôles que le site) et le lien `builderUrl`. `get_form` (administrateurs) donne aussi les `sectionId`, les sections vides d'un brouillon et sa `revision`, pour reprendre dans une autre conversation.
- **Choix.** `choices` remplace la liste complète, dans l'ordre voulu : reprendre la `key` des choix conservés (les réponses et la classification se lisent par clé). Une `key` explicite pour une section ou un champ évite un doublon si un appel est rejoué.
- **Rien d'écrit si c'est invalide.** Mêmes règles que le constructeur (choix réservés aux listes, limites adaptées au type et possibles, clés uniques, ordre complet) : l'outil répond par la raison, en français, et le brouillon n'est pas modifié.
- **Modifications simultanées.** Toutes les modifications d'un formulaire passent par le même verrou que le site. Avec `revision` (renvoyée par l'appel précédent), une modification est refusée si le brouillon a changé entre-temps, par exemple dans le site ; de même, le site refuse une modification si l'assistant a changé le brouillon depuis son affichage.
- **Jamais publié par l'assistant.** Le brouillon reste un brouillon, que l'administrateur vérifie puis publie dans le site ; les dossiers existants gardent leur version. La publication sur instruction explicite arrive ensuite (E04.08).
- **Droits.** Mêmes services et même règle que le constructeur du site, vérifiée à chaque appel : seul un administrateur conçoit des formulaires (un compte qui ne l'est plus est refusé, même avec une autorisation déjà accordée). Les outils de conception ne sont présentés qu'aux administrateurs ; sans `forms:write`, l'appel reçoit `403 insufficient_scope` pour que l'application la demande. Chaque appel est inscrit au journal avec le formulaire concerné.

## Documents

**Lire.** `read_document` renvoie le texte extrait par Confluent, sans OCR :

| Lu | Non lu (la raison est indiquée à l'assistant) |
|---|---|
| PDF dont le texte est sélectionnable (page par page ; les pages sans texte sont signalées) | Images (PNG, JPEG, WebP, HEIC) et PDF scannés : lecture/OCR non disponible |
| Word `.docx`, Excel `.xlsx` (feuille par feuille, cellules séparées par des tabulations, valeurs telles qu'enregistrées), PowerPoint `.pptx` (diapositive par diapositive) | Anciens formats Office `.doc`, `.xls`, `.ppt` |
| OpenDocument `.odt`, `.ods`, `.odp` ; CSV et texte `.txt` (UTF-8 ou Windows-1252) | PDF protégé par mot de passe, fichier endommagé |

Les documents longs sont découpés en parties d'environ 20 000 caractères ; au-delà de 400 000 caractères ou 300 pages, la suite n'est pas lue (l'assistant en est averti). Les commentaires, modifications suivies supprimées, notes de l'orateur et objets incorporés ne sont pas lus. L'analyse d'un PDF se fait dans un fil d'exécution isolé, limité en mémoire et en durée.

**Contenu non fiable.** Le texte d'un document est renvoyé comme une donnée fournie par un tiers (`contentTrust: non_fiable`), entre des marqueurs aléatoires propres à chaque appel, avec la consigne de n'exécuter aucune instruction qu'il contient. Aucun outil ne s'appuie sur ce contenu pour agir.

**Proposer des réponses.** L'assistant rapproche le texte des questions restantes (`next_questions`), présente chaque valeur trouvée avec sa source (fichier, page ou feuille) et ne l'enregistre avec `update_answers` qu'après confirmation de l'utilisateur, en citant le document (voir ci-dessous). Si l'utilisateur lui demande de pré-remplir sans confirmer chaque valeur, il enregistre des propositions sourcées, qui restent « à confirmer » (affichage et confirmation dans le site : E04.05).

**Déposer.** Un assistant transmet le fichier dans l'appel d'outil lui-même : `upload_document` est réservé aux petits fichiers (512 Ko). Pour le reste, l'assistant donne le lien `uploadUrl` de la question, qui ouvre cette question dans le site (dépôt jusqu'à 20 Mo). Formats acceptés et vérification d'après le contenu : identiques au site.

**Droits.** Propriétaire : tous les documents de ses dossiers ; dépôt avec `dossiers:write`. Financeur : les documents que son niveau de partage permet de lire dans le site (celui de la question pour une pièce jointe, partage complet pour les autres documents), jamais de dépôt. Aucune URL de téléchargement n'est transmise à l'assistant.

Chaque appel est inscrit au journal (utilisateur, application, outil, cible, document lu ou déposé, résultat).

## Provenance des réponses

Chaque réponse garde la provenance de sa valeur actuelle, remplacée à chaque modification (site, administration ou assistant) :

| Élément | Valeurs | D'où elle vient |
|---|---|---|
| `origin` | `human` (donnée par l'utilisateur, dans le site ou la conversation), `ai` (proposée par l'assistant) | Site et administration : toujours `human`. MCP : déclarée par l'assistant pour chaque réponse (obligatoire) |
| `confirmation` | `confirmed`, `pending` | `human` est toujours `confirmed` ; une proposition `ai` est `pending` sauf `confirmedByUser: true` |
| `channel`, `authorId`, `clientName` | `site`, `admin`, `mcp` ; compte qui écrit ; nom de l'application IA | Session ou jeton OAuth, jamais déclarés par l'assistant |
| `recordedAt` | date | Date d'enregistrement de la valeur |
| `source` | document et version (`documentId`, nom, numéro), `location` (page, feuille, diapositive), `excerpt` (500 caractères au plus) | Citée par l'assistant, **vérifiée par Confluent** |

**Rien d'inventé.** Une source doit être un document de ce dossier (`documentId` de `list_documents`). Un extrait doit se trouver dans le texte de cette version, tel que `read_document` le renvoie (espaces, casse, guillemets et ligatures ignorés) : Confluent note lui-même la page ou la feuille où il l'a trouvé. Un extrait introuvable, ou cité dans un document que Confluent ne sait pas lire (image, PDF scanné), est refusé ; le document peut alors être cité sans extrait. Une proposition non confirmée doit citer un document. En cas de refus, aucune réponse de l'appel n'est enregistrée.

**Qui la voit.** Le propriétaire : dans `get_dossier` et dans l'API du site (`GET /v1/dossiers/:id/answers`, champ `provenance`, `null` pour une réponse enregistrée avant cette fonction). Les administrateurs dans le détail d'un dossier. Jamais un financeur, ni dans le site ni par MCP.

## Pour l'exploitation

- `API_PUBLIC_URL` (API) doit valoir l'URL HTTPS publique exacte de l'API, et `VITE_API_URL` (web) la même valeur : c'est l'émetteur OAuth et la base de l'adresse `/mcp`.
- L'API doit être joignable depuis Internet par les serveurs de Claude (plage de sortie Anthropic `160.79.104.0/21`) et d'OpenAI ; aucune liste blanche IP n'est nécessaire sur `api.confluent.network`.
- Points de contrôle : `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-authorization-server`, `POST /mcp` sans jeton → `401` avec `WWW-Authenticate: Bearer resource_metadata="…"`.
- Retours OAuth acceptés : HTTPS ou loopback (`http://localhost:<port>`, utilisé par Claude Code et les inspecteurs MCP).

## Recette E01.09 (à exécuter dans chaque client)

Connexion → `whoami` → `get_dossier` → `update_answers` sur un champ de test → réponse visible dans le site → reconnexion → révocation dans le site → appel suivant refusé. Essais négatifs : dossier d'un autre compte (introuvable), connexion en lecture seule puis écriture (permission demandée).
