# Story 11.6: Email Preview & Test Tooling

Status: done

Outillage dev pour itérer rapidement sur les templates email et les valider end-to-end avant push. Deux commandes complémentaires, aucune nouvelle dépendance.

## AC

1. **`pnpm --filter @confluent/api email:preview`** ([apps/api/scripts/email-preview.ts](../../../../../apps/api/scripts/email-preview.ts)) :
   - Lance un serveur HTTP minimal (pur `node:http`, aucune devDep ajoutée) sur `localhost:4000`.
   - `GET /` liste tous les templates dispo + sélecteur de locale.
   - `GET /<name>?locale=fr` rend le HTML avec les valeurs de `samples.json` + injecte `<script>setTimeout(() => location.reload(), 2000)</script>` pour live-reload toutes les 2 s.
   - `GET /<name>.txt?locale=fr` renvoie la version `text/plain`.
   - Découverte automatique des templates (lit `templates/*.html`) et des locales (lit `templates/i18n/*.json`).
2. **`pnpm --filter @confluent/api email:test`** ([apps/api/scripts/email-send-test.ts](../../../../../apps/api/scripts/email-send-test.ts)) :
   - Charge `.env`.
   - **Pré-check de connexion SMTP** (probe TCP 2 s) → si Mailhog/SMTP injoignable, affiche un message d'aide clair avec les commandes pour démarrer Mailhog (`docker run mailhog/mailhog`) ou maildev (`pnpm dlx maildev`).
   - Instancie directement `NodemailerTransport` (sans Nest bootstrap, démarrage rapide) et envoie une copie de chaque template (magic-link + share-invite) à `EMAIL_TEST_TO` (défaut `test@confluent.local`).
   - Affiche l'URL Mailhog (`http://localhost:8025`) à la fin.
3. **Scripts déclarés** dans [apps/api/package.json](../../../../../apps/api/package.json) :
   - `"email:preview": "tsx scripts/email-preview.ts"`
   - `"email:test": "tsx scripts/email-send-test.ts"`
4. **Smoke verifié** :
   - Preview server : `GET /` renvoie l'index, `GET /magic-link?locale=fr` rend le HTML complet avec placeholders substitués, `GET /magic-link.txt` rend le texte propre, `GET /share-invite` inclut bien `Biosensio · Pre-seed 2026`.
   - Send-test : sans Mailhog, échec propre avec exit 1 + message d'aide. Avec Mailhog (smoke à reproduire localement), les deux emails arrivent sur `:8025`.

## Tasks

- [x] Écrire `scripts/email-preview.ts` (~110 lignes, pur Node)
- [x] Écrire `scripts/email-send-test.ts` (~80 lignes, dotenv + probe TCP)
- [x] Déclarer les scripts dans `package.json`
- [x] Smoke test preview (curl sur les 3 routes) — OK
- [x] Smoke test send-test sans Mailhog → message d'aide affiché — OK

## Décisions cadrées

- **Pas de framework / pas de devDep ajoutée** : `node:http` + `tsx` (déjà devDep) suffisent. `chokidar` aurait permis le watch + websocket reload, mais polling 2 s est OK pour un outil dev local et coûte 0 dépendance.
- **Preview + send-test = deux outils complémentaires** :
  - `preview` = itération rapide (mise en page, typo, contenu i18n). Pas d'envoi réel.
  - `send-test` = validation end-to-end (rendu Mailhog, headers `multipart/alternative`, subject, preheader).
- **`samples.json` versionné** au lieu de hardcoder les valeurs dans le script preview : un changement de structure (nouveau placeholder) se fait en un seul endroit.

## References

- [apps/api/scripts/email-preview.ts](../../../../../apps/api/scripts/email-preview.ts)
- [apps/api/scripts/email-send-test.ts](../../../../../apps/api/scripts/email-send-test.ts)
- [apps/api/src/modules/auth/email/templates/samples.json](../../../../../apps/api/src/modules/auth/email/templates/samples.json)
- Story 11.4 (templates) — fournit la matière à prévisualiser
