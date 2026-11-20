# Story 11.7: `/auth` — Mention "Invitation requise"

Status: done

`POST /v1/auth/magic-link` est volontairement opaque pour un email inconnu (anti-énumération NFR — la réponse est toujours `200 OK { message: 'Magic link sent.' }`). Mais côté UX, un user invité qui s'est planté d'adresse voyait "Vérifiez votre boîte mail" et n'aurait jamais compris pourquoi rien n'arrive. Cette story ajoute une copie statique qui aligne l'UX sur la réalité du flow : pas de self-registration, l'invitation est requise.

## AC

1. Sous le formulaire de [/auth](../../../../../apps/web/src/routes/auth/index.tsx) (au-dessus de "Pas de mot de passe — vérifiez votre boîte mail"), ajout d'un `<p>` :

   > Aucun compte n'est créé automatiquement. Pour recevoir un lien, vous devez avoir été invité par un administrateur ou par un entrepreneur qui partage un dossier avec vous.

2. Affiché uniquement quand le formulaire est visible (pas après `sent === true` — la copie "Vérifiez votre boîte mail" reste alors centrale).
3. Style cohérent avec le reste : `text-center text-xs text-muted-foreground`.

## Tasks

- [x] Édition `apps/web/src/routes/auth/index.tsx` (1 `<p>` ajouté)

## References

- [apps/web/src/routes/auth/index.tsx](../../../../../apps/web/src/routes/auth/index.tsx)
- Story 6.2 (anti-énumération — la raison du no-op silencieux pour un email inconnu)
- Story 11.3 (auto-création user au partage — le 2e canal d'arrivée légitime)
