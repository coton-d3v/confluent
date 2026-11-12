import { ConflictException, ForbiddenException } from '@nestjs/common'
import {
  COMMITTEE_APPLICATION_STATUS_LABELS,
  COMMITTEE_STATUS_LABELS,
  FINANCING_STATUS_LABELS,
  type CommitteeApplicationSide,
  type CommitteeApplicationStatus,
  type CommitteeStatus,
  type FinancingStatus,
} from '@confluent/shared'

const stateOf = (status: CommitteeApplicationStatus | null) =>
  status === null ? 'sans participation' : `« ${COMMITTEE_APPLICATION_STATUS_LABELS[status]} »`

// Errors of a request's entries on committees (ROADMAP E08.03), with messages shown as is in the
// site. An unknown committee, candidature or workspace is refused with their own `404`.
export const CommitteeApplicationErrors = {
  // The client worked from another state: nothing is overwritten.
  changed: (status: CommitteeApplicationStatus | null, version: number | null) =>
    new ConflictException({
      code: 'COMMITTEE_APPLICATION_CHANGED',
      message:
        'La participation de cette demande à ce comité a changé entre-temps : rechargez la page avant de la modifier.',
      details: { status, version },
    }),
  impossible: (from: CommitteeApplicationStatus | null, to: CommitteeApplicationStatus) =>
    new ConflictException({
      code: 'COMMITTEE_APPLICATION_TRANSITION_IMPOSSIBLE',
      message: `Une participation ${stateOf(from)} ne peut pas passer à « ${COMMITTEE_APPLICATION_STATUS_LABELS[to]} ».`,
    }),
  forbidden: (to: CommitteeApplicationStatus, by: CommitteeApplicationSide) =>
    new ForbiddenException({
      code: 'COMMITTEE_APPLICATION_TRANSITION_FORBIDDEN',
      message:
        by === 'owner'
          ? `« ${COMMITTEE_APPLICATION_STATUS_LABELS[to]} » est décidé par la structure.`
          : `« ${COMMITTEE_APPLICATION_STATUS_LABELS[to]} » est décidé par le porteur de projet.`,
    }),
  committeeClosed: (status: CommitteeStatus) =>
    new ConflictException({
      code: 'COMMITTEE_CLOSED',
      message: `Ce comité est « ${COMMITTEE_STATUS_LABELS[status]} » : ses participations ne changent plus tant qu’il n’est pas de nouveau programmé.`,
    }),
  committeeStarted: () =>
    new ConflictException({
      code: 'COMMITTEE_STARTED',
      message:
        'Ce comité a commencé : il n’est plus possible d’y candidater ni de confirmer une participation.',
    }),
  notSent: () =>
    new ConflictException({
      code: 'CANDIDATURE_NOT_SENT',
      message:
        'Envoyez d’abord la candidature à la structure : ses comités vous sont ouverts une fois qu’elle la reçoit.',
    }),
  financingClosed: (status: FinancingStatus) =>
    new ConflictException({
      code: 'FINANCING_CLOSED',
      message: `La demande est « ${FINANCING_STATUS_LABELS[status]} » auprès de cette structure : elle n’est plus présentée en comité.`,
    }),
}
