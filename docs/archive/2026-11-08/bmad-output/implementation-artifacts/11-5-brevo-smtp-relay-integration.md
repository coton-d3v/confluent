# Story 11.5: Brevo SMTP Relay Integration

Status: done

Aligne le transport email production sur Brevo (NFR17 mentionne explicitement Brevo). Choix architectural cadré : **relais SMTP** (pas l'API HTTPS Brevo, pas les templates Brevo éditables). On garde `nodemailer`, le code reste **agnostique du provider** : si on bascule un jour sur un autre relais, seul l'env change. Aucune dépendance Brevo n'est introduite dans le code.

## AC

1. **`NodemailerTransport`** ([apps/api/src/modules/auth/email/nodemailer.transport.ts](../../../../../apps/api/src/modules/auth/email/nodemailer.transport.ts)) configure :
   - `secure: port === 465` (TLS implicite uniquement sur 465),
   - `requireTLS: port !== 25 && port !== 465` (force STARTTLS sur 587 — port standard Brevo),
   - `auth: { user, pass }` quand `SMTP_USER` est défini.
2. **Aucune dépendance Brevo dans le code** : pas de `@getbrevo/brevo`, pas de `axios → api.brevo.com`. Le code parle SMTP standard ; Brevo n'est qu'une valeur de `SMTP_HOST`.
3. **`.env.example`** ([apps/api/.env.example](../../../../../apps/api/.env.example)) documente :
   - Mailhog par défaut pour dev (`SMTP_HOST=localhost, SMTP_PORT=1025`).
   - Brevo prod commenté avec instructions sourcing creds (`smtp-relay.brevo.com:587`, login = email du compte Brevo, password = clé SMTP générée dans Brevo > SMTP & API, sender = expéditeur vérifié dans Brevo > Senders).
4. **Pas de migration de `config.schema.ts`** : les vars `SMTP_HOST/PORT/USER/PASSWORD/FROM` y sont déjà.
5. **Smoke test prod différé à staging** : checklist documentée dans Story 11.6 + plan-de-vérification. Coolify est la cible : variables override par environnement.

## Tasks

- [x] Ajuster `NodemailerTransport` (TLS sur 465, STARTTLS sur 587)
- [x] Créer `apps/api/.env.example` (n'existait pas — on n'avait que `.env` non versionné)
- [x] Documenter dans `templates/README.md` le piège "sender non vérifié" Brevo

## Décisions cadrées

- **SMTP relay vs API Brevo** : SMTP retenu pour rester agnostique. L'API Brevo permettrait d'utiliser les templates éditables côté dashboard mais accroche le code à un provider spécifique. Si besoin un jour, créer un `BrevoApiTransport` implémentant la même interface `EmailTransport` — les services consommateurs ne bougent pas.
- **`requireTLS` conditionnel** : on garde la possibilité d'utiliser le port 25 en dev (Mailhog) ou un SMTP local sans TLS, sans casser STARTTLS sur les ports standards prod.

## References

- [apps/api/.env.example](../../../../../apps/api/.env.example)
- [apps/api/src/modules/auth/email/nodemailer.transport.ts](../../../../../apps/api/src/modules/auth/email/nodemailer.transport.ts)
- NFR17 (email transport abstrait, swap sans changement code)
- Story 11.4 (templates rendus côté serveur, indépendants du provider)
