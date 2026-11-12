import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { FUNDING_PLAN_LIMITS } from '@confluent/shared'

// Errors of a candidature's financing plan (ROADMAP E06.03), with messages shown as is in the site.
// Reaching the candidature is refused with the candidatures' errors (`CandidatureErrors`).
export const FundingPlanErrors = {
  lineNotFound: () =>
    new NotFoundException({
      code: 'FUNDING_PLAN_LINE_NOT_FOUND',
      message: 'Cette ligne n’existe plus dans le plan de financement : rechargez la page.',
    }),
  // Someone changed the line since the client read it: nothing is overwritten.
  lineChanged: (current: number) =>
    new ConflictException({
      code: 'FUNDING_PLAN_LINE_CHANGED',
      message:
        'Cette ligne a été modifiée entre-temps : rechargez le plan avant de la modifier à nouveau.',
      details: { currentVersion: current },
    }),
  // The same answer for a category that does not exist and one of another workspace.
  categoryUnknown: () =>
    new BadRequestException({
      code: 'FUNDING_PLAN_CATEGORY_UNKNOWN',
      message: 'Choisissez une des sources proposées par la structure.',
      details: [{ path: ['categoryId'], message: 'Source inconnue dans ce workspace.' }],
    }),
  categoryInactive: (label: string) =>
    new ConflictException({
      code: 'FUNDING_PLAN_CATEGORY_INACTIVE',
      message: `La source « ${label} » n’est plus proposée par la structure : choisissez-en une autre.`,
      details: [{ path: ['categoryId'], message: 'Source désactivée.' }],
    }),
  // E06.04: the same answer for a pledge withdrawn, changed since it was read, no longer read by its
  // investor, hiding its name or amount, of another request, or unknown — nothing tells them apart.
  pledgeChanged: () =>
    new ConflictException({
      code: 'FUNDING_PLAN_PLEDGE_CHANGED',
      message:
        'Cette promesse a changé, a été retirée ou ne vous est plus montrée : rechargez le plan avant de la confirmer.',
    }),
  pledgeHeld: () =>
    new ConflictException({
      code: 'FUNDING_PLAN_PLEDGE_HELD',
      message:
        'Cette promesse est déjà confirmée par une autre ligne du plan : détachez-la de cette ligne d’abord.',
    }),
  pledgeState: () =>
    new ConflictException({
      code: 'FUNDING_PLAN_PLEDGE_STATE',
      message:
        'Une promesse se confirme par une source en cours ou obtenue : changez d’abord l’état de la ligne.',
      details: [{ path: ['state'], message: 'En cours ou obtenu.' }],
    }),
  pledgeOwnerOnly: () =>
    new ForbiddenException({
      code: 'FUNDING_PLAN_PLEDGE_OWNER_ONLY',
      message: 'Seul le porteur de projet confirme une promesse dans son plan de financement.',
    }),
  tooMany: () =>
    new ConflictException({
      code: 'FUNDING_PLAN_LIMIT',
      message: `Un plan de financement compte au plus ${FUNDING_PLAN_LIMITS.linesPerPlan} lignes : regroupez ou supprimez des lignes.`,
    }),
}
