# Ajouter un workspace

Un workspace est l'espace d'une structure (CCI, incubateur, réseau d'investisseurs, club deal) : ses conseillers et investisseurs, ses formulaires, ses comités et sa page publique `/w/<slug>`. Seul un administrateur de Confluent le crée ; ses gestionnaires (conseillers ayant le droit de gestion) le règlent ensuite.

## 1. Créer

**Administration › Workspaces › Nouveau workspace** :

| Champ | Remarque |
|---|---|
| Nom de la structure | obligatoire |
| Slug | adresse publique `/w/<slug>` : minuscules sans accent, chiffres, tirets simples, 2 à 60 caractères. **Ne change plus après la création.** |
| Nom du programme, couleur (`#RRGGBB`), présentation, email de contact | facultatifs ; l'email de contact n'est jamais affiché publiquement |
| Domaine email autorisé | facultatif, réservé aux administrateurs : les conseillers invités devront avoir une adresse de ce domaine (pas les investisseurs) |

**Créer le workspace** ouvre sa page d'administration (onglets Réglages, Membres, Formulaires, Sources de financement, Dispositifs, Parcours d'accompagnement, Page publique, Demandes reçues). Le logo (PNG, JPEG ou WebP, 1 Mo) se dépose ensuite dans Réglages ; il va dans le bucket S3 (`503` si le stockage est injoignable).

## 2. Inviter les membres

Onglet **Membres › Inviter un membre** : adresse, rôle **Conseiller** (équipe de la structure) ou **Investisseur** (communauté), organisation facultative, case **Peut gérer le workspace** pour un conseiller gestionnaire. Un compte est créé si l'adresse est inconnue ; la personne reçoit un email d'invitation et se connecte par lien magique. Un membre se modifie ou se désactive depuis la même liste.

Nommer au moins un conseiller gestionnaire : il règle ensuite seul les réglages, la page publique, les membres et les formulaires du workspace, depuis **Mes workspaces**.

## 3. Formulaires et parcours

Onglet **Formulaires** : formulaires de candidature et de suivi propres à la structure (brouillon puis publication, comme les formulaires de Confluent). Les onglets Sources de financement, Dispositifs et Parcours d'accompagnement décrivent l'offre de la structure. L'appel à candidater de la page publique n'apparaît que tant qu'un formulaire de candidature est publié.

## 4. Page publique

Onglet **Page publique** :

1. Cocher **Page publique visible** (décochée par défaut : `/w/<slug>` répond « Aucune page publique à cette adresse », comme une adresse inconnue).
2. Remplir Critères et Contact public (visible de tous), choisir et ordonner les blocs (présentation, critères, prochains comités, projets accompagnés, appel à candidater, appel à participer, contact) ; un bloc sans contenu n'apparaît pas.
3. **Autoriser l'indexation par les moteurs de recherche** : décochée par défaut (`noindex`) ; voir [deploiement.md § Indexation](../deploiement.md#indexation-par-les-moteurs-de-recherche-e0906).
4. **Enregistrer la page publique**, vérifier l'aperçu, puis ouvrir `https://confluent.example.org/w/<slug>` dans une fenêtre privée.

La page ne montre jamais les membres, l'email de contact des réglages ni les dossiers, hors les cartes anonymes que les entreprises choisissent d'y afficher. Les demandes envoyées depuis ses formulaires arrivent dans l'onglet **Demandes reçues**.

## Par une application IA

Les gestionnaires peuvent aussi lire et modifier la page publique ou concevoir les formulaires du workspace depuis un assistant connecté ([mcp.md](../mcp.md)) ; la création d'un workspace reste réservée au site.
