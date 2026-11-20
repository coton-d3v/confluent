# Story 11.4: Email Templates — HTML Statique + i18n Single-Source

Status: done

Les emails Confluent vivaient inline dans le TypeScript ([auth.service.ts:51-57](../../../../../apps/api/src/modules/auth/auth.service.ts#L51), [share-links.service.ts:74-86](../../../../../apps/api/src/modules/share-links/share-links.service.ts)) : non éditables sans recompiler, non prévisualisables, pas de variante traduisible. Cette story extrait le contenu dans un dossier `templates/`, un fichier HTML par email (single source pour toutes les langues), et un JSON par langue qui contient toutes les strings traduisibles. Préserve la DA Notion du front, compatible Outlook/Apple Mail/Gmail.

## AC

1. **Dossier `apps/api/src/modules/auth/email/templates/`** créé contenant :
   - `magic-link.html` + `magic-link.txt` (variante text/plain, mêmes placeholders)
   - `share-invite.html` + `share-invite.txt`
   - `i18n/fr.json` (toutes les strings traduisibles, organisées par template name)
   - `samples.json` (valeurs dynamiques pour la preview de Story 11.6)
   - `README.md` (règles d'édition + tokens DA + checklist cross-client)
2. **HTML statique ouvrable dans un navigateur** : `open templates/magic-link.html` rend la mise en page (les `{{key}}` apparaissent en littéral) — suffisant pour valider typographie et layout sans serveur.
3. **DA reprise du front** ([apps/web/src/index.css](../../../../../apps/web/src/index.css#L51-L90)) : palette Notion (`#FAFAF9` background, `#37352F` primary, `#1A1A1A` foreground, `#6B6B6B` muted, `#E8E8E7` border, radius 6px), font-family `Inter` + fallback système. Couleurs hardcodées (pas de variables CSS — Outlook ne les supporte pas).
4. **Compatibilité cibles obligatoires** : Outlook 2016+ (Win + Mac), Outlook.com, Apple Mail iOS 13+ + macOS, Gmail (web + apps iOS/Android), Yahoo Mail (best-effort). Patterns appliqués :
   - Doctype XHTML 1.0 Transitional.
   - Layout 100% `<table role="presentation">` imbriquées (pas de flex/grid).
   - Largeur max 600px, bloc principal 560px (attribut `width=` + style CSS).
   - CSS 100% inline. Une seule `<style>` tolérée dans `<!--[if mso]>…<![endif]-->` (force la police sur Outlook qui ignore Inter).
   - Bouton CTA "bulletproof" : `<table>` + `<td bgcolor>` + `<a>` avec padding ; `border-radius` ignoré sur Outlook Windows → carré accepté.
   - Préheader caché (`display:none; max-height:0; mso-hide:all; color:#FAFAF9`) qui devient l'aperçu inbox.
   - Dark-mode forcé en `light only` via `<meta name="color-scheme">` + `<meta name="supported-color-schemes">`.
   - `<meta name="format-detection" content="telephone=no,…">` pour empêcher l'auto-link Apple Mail.
5. **i18n single-source** : 1 HTML par email + 1 JSON par langue. Le HTML utilise `{{key}}` qui peut référencer indifféremment une string i18n (depuis `i18n/<locale>.json`) ou une variable dynamique (URL, nom du dossier). Pour ajouter une langue, copier `fr.json` → `en.json`, traduire les valeurs, élargir le type `Locale`. **Pas de duplication HTML**.
6. **`TemplateRenderer`** à [apps/api/src/modules/auth/email/template-renderer.ts](../../../../../apps/api/src/modules/auth/email/template-renderer.ts) :
   - Fonctions pures (pas un service Nest), cache en mémoire des fichiers chargés (`readFileSync` une seule fois par template).
   - `render(name, locale, dynamicVars) → { subject, html, text }` ; subject pris dans le JSON i18n.
   - **HTML-escape** toutes les valeurs substituées dans le rendu HTML (XSS-safe) ; PAS d'escape dans la version text/plain (newlines préservés).
   - **Erreur explicite** si une variable est manquante (`Missing email template variable: {{xxx}}`).
7. **`EmailTransport` refactorée** ([email-transport.ts](../../../../../apps/api/src/modules/auth/email/email-transport.ts)) avec méthodes **typées par cas d'usage** (le `sendMail` générique disparaît) :
   - `sendMagicLink({ to, magicLinkUrl, locale })`
   - `sendShareInvite({ to, dossierName, shareUrl, locale })`
   - `type Locale = 'fr'` (extensible).
8. **`NodemailerTransport`** ([nodemailer.transport.ts](../../../../../apps/api/src/modules/auth/email/nodemailer.transport.ts)) implémente les deux méthodes en passant par `render()`, helper privé `send()` qui factorise `transporter.sendMail` + `from` + `try/catch + logger.warn`.
9. **`nest-cli.json`** copie `templates/**/*.{html,txt,json,md}` dans `dist/` (`compilerOptions.assets`) — sinon `readFileSync(join(__dirname, 'templates', …))` casse en prod.
10. **Spec `template-renderer.spec.ts`** : substitution OK, variable manquante throws, XSS-escape côté HTML, no-escape côté text, charge `fr.json` correctement.

## Tasks

- [x] Créer `template-renderer.ts` + spec
- [x] Créer `templates/{magic-link,share-invite}.{html,txt}` + `i18n/fr.json` + `samples.json`
- [x] Rédiger `templates/README.md` (règles email-HTML détaillées)
- [x] Refactor `EmailTransport` (interface typée)
- [x] Refactor `NodemailerTransport` (utilise `render`)
- [x] Configurer `nest-cli.json` assets
- [x] Mettre à jour `AuthService.requestMagicLink` + `ShareLinksService.create` (les deux consommateurs de l'interface)
- [x] Mettre à jour specs/e2e (mocks `sendMagicLink`/`sendShareInvite`)
- [x] Tests verts

## Décisions cadrées

- **Single-source HTML + JSON i18n** plutôt que dupliquer le HTML par langue. Pour N langues, on a N JSON et 1 HTML.
- **Méthodes typées par cas d'usage** dans l'interface — chaque template a son contrat ; ajouter un email = ajouter une méthode (signal clair pour les reviewers).
- **Pas de VML** pour les rounded corners sur Outlook Windows en V1 → bouton à coin carré accepté comme dégradation gracieuse.
- **Pas de framework** type MJML / react-email : tout est statique, ouvrable directement dans un navigateur (cf. Story 11.6 preview).

## References

- [apps/api/src/modules/auth/email/templates/README.md](../../../../../apps/api/src/modules/auth/email/templates/README.md)
- Story 6.2 (Magic Link Generation) — emails inline avant
- Story 8.1 (Share Link Email) — idem
- Story 11.6 (Email Preview Tooling) — consomme `samples.json`
