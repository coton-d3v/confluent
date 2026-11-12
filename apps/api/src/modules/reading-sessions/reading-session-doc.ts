import { READING_SESSION_GAP_MINUTES } from '@confluent/shared'

// What a reading session is, said once (E07.08, @confluent/shared `reading.schema.ts`).
export const READING_SESSION_DOC =
  'Une **consultation** est une session de lecture ouverte par le serveur au chargement de la ' +
  'page d’un lien de partage (`GET /v1/shares/:token`) ou d’une opportunité (`GET ' +
  '/v1/opportunities/:dossierId`) ; un nouveau chargement du même compte, sur la même demande, par ' +
  `le même partage direct (ou aucun), moins de ${READING_SESSION_GAP_MINUTES} minutes après sa ` +
  'dernière activité la reprend (rechargements, redirections, connexion, double effet, second ' +
  'onglet : une seule vue), journalisée une fois. Seules les lectures par un **partage direct** ' +
  'sont mesurées (`reading` non nul) et montrées au porteur ; les lectures par les seuls viviers ne ' +
  'sont ni chronométrées ni montrées au porteur, pas même un nombre (D05).'
