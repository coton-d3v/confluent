import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { SUPPORT_STEP_LIMITS } from '@confluent/shared'

// Errors of a workspace's support path and of a candidature's validated steps (ROADMAP E06.06), with
// messages shown as is in the site. Managing the steps is refused with the workspace management
// error (`WorkspaceErrors`), reaching a candidature with the candidatures' errors.
export const SupportPathErrors = {
  stepsReadForbidden: () =>
    new ForbiddenException({
      code: 'SUPPORT_STEPS_FORBIDDEN',
      message: 'Le parcours d’accompagnement d’un workspace est lu par ses conseillers.',
    }),
  // The same answer for a step that does not exist and one of another workspace.
  stepNotFound: () =>
    new NotFoundException({
      code: 'SUPPORT_STEP_NOT_FOUND',
      message: 'Étape introuvable dans le parcours de ce workspace.',
    }),
  stepLabelTaken: (label: string) =>
    new ConflictException({
      code: 'SUPPORT_STEP_LABEL_TAKEN',
      message: `Une étape s’appelle déjà « ${label} » dans ce parcours.`,
      details: [{ path: ['label'], message: 'Ce libellé est déjà utilisé.' }],
    }),
  tooManySteps: () =>
    new ConflictException({
      code: 'SUPPORT_STEP_LIMIT',
      message: `Un parcours compte au plus ${SUPPORT_STEP_LIMITS.perWorkspace} étapes : renommez ou réactivez plutôt une étape existante.`,
    }),
  // The list the site reordered is no longer the workspace's (a step added meanwhile).
  stepOrderStale: () =>
    new ConflictException({
      code: 'SUPPORT_STEP_ORDER_STALE',
      message: 'Le parcours a changé entre-temps : rechargez-le avant de modifier son ordre.',
    }),
  // A deactivated step keeps its validations, frozen: neither validated nor reopened.
  stepInactive: (label: string) =>
    new ConflictException({
      code: 'SUPPORT_STEP_INACTIVE',
      message: `L’étape « ${label} » ne fait plus partie du parcours de la structure.`,
    }),
  // Someone validated or reopened the step since the client read it: nothing is overwritten.
  changed: (current?: number) =>
    new ConflictException({
      code: 'SUPPORT_STEP_CHANGED',
      message:
        'Cette étape a été modifiée entre-temps : rechargez la page avant de la modifier à nouveau.',
      ...(current !== undefined ? { details: { currentVersion: current } } : {}),
    }),
}
