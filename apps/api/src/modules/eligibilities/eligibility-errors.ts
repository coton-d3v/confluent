import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ELIGIBILITY_SCHEME_LIMITS } from '@confluent/shared'

// Errors of a workspace's eligibility schemes and of a candidature's eligibilities (ROADMAP E06.05),
// with messages shown as is in the site. Managing the schemes is refused with the workspace
// management error (`WorkspaceErrors`), reaching a candidature with the candidatures' errors.
export const EligibilityErrors = {
  schemesReadForbidden: () =>
    new ForbiddenException({
      code: 'ELIGIBILITY_SCHEMES_FORBIDDEN',
      message: 'Les dispositifs d’un workspace sont lus par ses conseillers.',
    }),
  schemeNotFound: () =>
    new NotFoundException({
      code: 'ELIGIBILITY_SCHEME_NOT_FOUND',
      message: 'Dispositif introuvable dans ce workspace.',
    }),
  schemeLabelTaken: (label: string) =>
    new ConflictException({
      code: 'ELIGIBILITY_SCHEME_LABEL_TAKEN',
      message: `Un dispositif s’appelle déjà « ${label} » dans ce workspace.`,
      details: [{ path: ['label'], message: 'Ce libellé est déjà utilisé.' }],
    }),
  tooManySchemes: () =>
    new ConflictException({
      code: 'ELIGIBILITY_SCHEME_LIMIT',
      message: `Un workspace compte au plus ${ELIGIBILITY_SCHEME_LIMITS.perWorkspace} dispositifs : renommez ou réactivez plutôt un dispositif existant.`,
    }),
  // The list the site reordered is no longer the workspace's (a scheme added meanwhile).
  schemeOrderStale: () =>
    new ConflictException({
      code: 'ELIGIBILITY_SCHEME_ORDER_STALE',
      message:
        'La liste des dispositifs a changé entre-temps : rechargez-la avant de modifier son ordre.',
    }),
  // The same answer for a scheme that does not exist and one of another workspace.
  schemeUnknown: () =>
    new BadRequestException({
      code: 'ELIGIBILITY_SCHEME_UNKNOWN',
      message: 'Choisissez un des dispositifs proposés par la structure.',
      details: [{ path: ['schemeId'], message: 'Dispositif inconnu dans ce workspace.' }],
    }),
  schemeInactive: (label: string) =>
    new ConflictException({
      code: 'ELIGIBILITY_SCHEME_INACTIVE',
      message: `Le dispositif « ${label} » n’est plus proposé par la structure.`,
      details: [{ path: ['schemeId'], message: 'Dispositif désactivé.' }],
    }),
  // MCP (code review R62): a working tool does not remove an eligibility the workspace verified;
  // withdrawing the verification is a decision of its own. Checked under the candidature's lock.
  verifiedRemovalRefused: () =>
    new ConflictException({
      code: 'ELIGIBILITY_VERIFIED',
      message: 'Ce dispositif est vérifié par la structure : retirez d’abord la vérification.',
    }),
  alreadyDeclared: (label: string) =>
    new ConflictException({
      code: 'ELIGIBILITY_EXISTS',
      message: `L’éligibilité au dispositif « ${label} » est déjà indiquée : rechargez la page pour la modifier.`,
    }),
  notFound: () =>
    new NotFoundException({
      code: 'ELIGIBILITY_NOT_FOUND',
      message: 'Cette éligibilité n’existe plus : rechargez la page.',
    }),
  // Someone changed the eligibility since the client read it: nothing is overwritten.
  changed: (current: number) =>
    new ConflictException({
      code: 'ELIGIBILITY_CHANGED',
      message:
        'Cette éligibilité a été modifiée entre-temps : rechargez la page avant de la modifier à nouveau.',
      details: { currentVersion: current },
    }),
}
