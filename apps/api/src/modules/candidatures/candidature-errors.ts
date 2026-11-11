import {
  FINANCING_STATUS_LABELS,
  type FinancingStatus,
  type FinancingStatusActor,
} from '@confluent/shared'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'

// Errors of candidatures (ROADMAP E05.09), with messages shown as is in the site.
export const CandidatureErrors = {
  // The same answer for a candidature that does not exist and one the account may not read.
  notFound: () =>
    new NotFoundException({ code: 'CANDIDATURE_NOT_FOUND', message: 'Candidature introuvable.' }),
  // The same answer for an unknown workspace and one that receives no candidature.
  workspaceNotOpen: () =>
    new NotFoundException({
      code: 'WORKSPACE_NOT_OPEN',
      message: 'Cette structure est introuvable ou ne reçoit pas de candidatures.',
    }),
  exists: () =>
    new ConflictException({
      code: 'CANDIDATURE_EXISTS',
      message: 'Cette demande est déjà présentée à cette structure.',
    }),
  reviewForbidden: () =>
    new ForbiddenException({
      code: 'CANDIDATURES_FORBIDDEN',
      message: 'Les candidatures reçues par un workspace sont lues par ses conseillers.',
    }),
  profileNotSubmitted: () =>
    new UnprocessableEntityException({
      code: 'PROFILE_NOT_SUBMITTED',
      message:
        'Soumettez d’abord le profil de l’entreprise pour cette demande : la structure le reçoit avec votre candidature.',
    }),
  incomplete: (missing: Array<{ id: string; label: string }>) =>
    new UnprocessableEntityException({
      code: 'CANDIDATURE_INCOMPLETE',
      message: `${missing.length} réponse(s) obligatoire(s) manquante(s) au formulaire de la structure.`,
      details: missing.map((f) => ({ fieldId: f.id, label: f.label })),
    }),
  // E06.01: once sent, the workspace follows the candidature; its owner abandons it instead.
  sent: () =>
    new ConflictException({
      code: 'CANDIDATURE_SENT',
      message:
        'Cette candidature est envoyée : la structure la suit et la garde. Abandonnez-la plutôt que de la retirer.',
    }),
  notSent: () =>
    new ConflictException({
      code: 'CANDIDATURE_NOT_SENT',
      message: 'Le statut de financement évolue une fois la candidature envoyée à la structure.',
    }),
  // Someone else changed the status since the client read it: nothing is overwritten.
  statusChanged: (current: FinancingStatus) =>
    new ConflictException({
      code: 'FINANCING_STATUS_CHANGED',
      message: `Le statut a changé entre-temps : il est désormais « ${FINANCING_STATUS_LABELS[current]} ». Rechargez la page avant de le modifier.`,
      details: { current },
    }),
  transitionImpossible: (from: FinancingStatus, to: FinancingStatus) =>
    new ConflictException({
      code: 'FINANCING_TRANSITION_IMPOSSIBLE',
      message: `Le statut « ${FINANCING_STATUS_LABELS[from]} » ne peut pas passer à « ${FINANCING_STATUS_LABELS[to]} ».`,
    }),
  transitionForbidden: (to: FinancingStatus, actor: FinancingStatusActor) =>
    new ForbiddenException({
      code: 'FINANCING_TRANSITION_FORBIDDEN',
      message:
        actor === 'owner'
          ? `Le statut « ${FINANCING_STATUS_LABELS[to]} » est décidé par la structure.`
          : `Le statut « ${FINANCING_STATUS_LABELS[to]} » est décidé par le porteur de projet.`,
    }),
}
