import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { COMMITTEE_LIMITS, COMMITTEE_STATUS_LABELS, type CommitteeStatus } from '@confluent/shared'

// Errors of a workspace's committees (ROADMAP E08.01), with messages shown as is in the site.
// Entering the workspace and managing it are refused with the workspace errors (`WorkspaceErrors`).
export const CommitteeErrors = {
  readForbidden: () =>
    new ForbiddenException({
      code: 'COMMITTEES_FORBIDDEN',
      message: 'Les comités d’un workspace sont lus par ses conseillers.',
    }),
  // The same answer for a committee that does not exist and one of another workspace.
  notFound: () =>
    new NotFoundException({
      code: 'COMMITTEE_NOT_FOUND',
      message: 'Comité introuvable dans ce workspace.',
    }),
  tooMany: () =>
    new ConflictException({
      code: 'COMMITTEE_LIMIT',
      message: `Un workspace compte au plus ${COMMITTEE_LIMITS.perWorkspace} comités.`,
    }),
  // The client worked from another version: nothing is overwritten.
  changed: (current: number) =>
    new ConflictException({
      code: 'COMMITTEE_CHANGED',
      message: 'Ce comité a été modifié entre-temps : rechargez-le avant de le modifier à nouveau.',
      details: { currentVersion: current },
    }),
  notEditable: (status: CommitteeStatus) =>
    new ConflictException({
      code: 'COMMITTEE_NOT_EDITABLE',
      message: `Ce comité est « ${COMMITTEE_STATUS_LABELS[status]} » : seul un comité programmé se modifie. Remettez-le d’abord au statut « Programmé ».`,
    }),
  transition: (from: CommitteeStatus, to: CommitteeStatus) =>
    new ConflictException({
      code: 'COMMITTEE_STATUS_TRANSITION',
      message: `Ce comité est « ${COMMITTEE_STATUS_LABELS[from]} » : il ne peut pas passer à « ${COMMITTEE_STATUS_LABELS[to]} ».`,
    }),
  notStarted: () =>
    new ConflictException({
      code: 'COMMITTEE_NOT_STARTED',
      message: 'Ce comité n’a pas encore commencé : il ne peut pas être marqué comme tenu.',
    }),
  // The API's time zone data decides (it may know a change of offset the site does not).
  schedule: (message: string) =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: ['time'], message }],
    }),
}
