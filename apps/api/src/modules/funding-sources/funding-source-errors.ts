import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { FUNDING_SOURCE_CATEGORY_LIMITS } from '@confluent/shared'

// Errors of a workspace's funding source categories (ROADMAP E06.02), with messages shown as is in
// the site. Managing them is refused with the workspace management error (`WorkspaceErrors`).
export const FundingSourceErrors = {
  readForbidden: () =>
    new ForbiddenException({
      code: 'FUNDING_SOURCES_FORBIDDEN',
      message: 'Les sources du plan de financement d’un workspace sont lues par ses conseillers.',
    }),
  notFound: () =>
    new NotFoundException({
      code: 'FUNDING_SOURCE_CATEGORY_NOT_FOUND',
      message: 'Source de financement introuvable dans ce workspace.',
    }),
  labelTaken: (label: string) =>
    new ConflictException({
      code: 'FUNDING_SOURCE_LABEL_TAKEN',
      message: `Une source s’appelle déjà « ${label} » dans ce workspace.`,
      details: [{ path: ['label'], message: 'Ce libellé est déjà utilisé.' }],
    }),
  tooMany: () =>
    new ConflictException({
      code: 'FUNDING_SOURCE_LIMIT',
      message: `Un workspace compte au plus ${FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace} sources de financement : renommez ou réactivez plutôt une source existante.`,
    }),
  lastActive: () =>
    new ConflictException({
      code: 'FUNDING_SOURCE_LAST_ACTIVE',
      message:
        'C’est la dernière source active du workspace : activez-en une autre avant de la désactiver.',
    }),
  // The list the site reordered is no longer the workspace's (a category added meanwhile).
  orderStale: () =>
    new ConflictException({
      code: 'FUNDING_SOURCE_ORDER_STALE',
      message:
        'La liste des sources a changé entre-temps : rechargez-la avant de modifier son ordre.',
    }),
}
