import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { DraftProblem } from '@confluent/shared'

// Errors of the form builder, with messages shown as is to administrators.
export const FormErrors = {
  formNotFound: () =>
    new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Formulaire introuvable.' }),
  versionNotFound: () =>
    new NotFoundException({ code: 'VERSION_NOT_FOUND', message: 'Version introuvable.' }),
  draftNotFound: () =>
    new NotFoundException({
      code: 'DRAFT_NOT_FOUND',
      message: 'Ce formulaire n’a pas de brouillon en cours.',
    }),
  sectionNotFound: () =>
    new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section introuvable dans le brouillon.',
    }),
  fieldNotFound: () =>
    new NotFoundException({
      code: 'FIELD_NOT_FOUND',
      message: 'Champ introuvable dans le brouillon.',
    }),
  draftStale: () =>
    new ConflictException({
      code: 'DRAFT_STALE',
      message: 'Le brouillon a été modifié entre-temps : rechargez-le avant de continuer.',
    }),
  draftExists: () =>
    new ConflictException({
      code: 'DRAFT_EXISTS',
      message: 'Un brouillon est déjà en cours pour ce formulaire.',
    }),
  formArchived: () =>
    new ConflictException({
      code: 'FORM_ARCHIVED',
      message: 'Ce formulaire est archivé : restaurez-le avant de le modifier.',
    }),
  formInUse: () =>
    new ConflictException({
      code: 'FORM_IN_USE',
      message:
        'Ce formulaire est affecté à un usage : retirez cette affectation avant de l’archiver.',
    }),
  notPublished: () =>
    new ConflictException({
      code: 'FORM_NOT_PUBLISHED',
      message: 'Publiez une version de ce formulaire avant de l’affecter.',
    }),
  keyTaken: (key: string) =>
    new ConflictException({
      code: 'KEY_TAKEN',
      message: `La clé « ${key} » est déjà utilisée dans ce brouillon.`,
    }),
  invalidOrder: () =>
    new BadRequestException({
      code: 'INVALID_ORDER',
      message: 'L’ordre doit contenir exactement une fois chaque élément à ordonner.',
    }),
  choicesNotAllowed: () =>
    new BadRequestException({
      code: 'CHOICES_NOT_ALLOWED',
      message: 'Seul un champ de type liste peut avoir des choix.',
    }),
  invalidConstraints: (message: string) =>
    new BadRequestException({ code: 'INVALID_CONSTRAINTS', message }),
  draftInvalid: (problems: DraftProblem[]) =>
    new UnprocessableEntityException({
      code: 'DRAFT_INVALID',
      message: 'Le brouillon ne peut pas encore être publié.',
      details: problems,
    }),
}
