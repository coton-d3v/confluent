import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { WORKSPACE_LOGO_FORMATS_LABEL } from '@confluent/shared'

// Errors of workspace management, with messages shown as is to administrators.
export const WorkspaceErrors = {
  forbidden: () =>
    new ForbiddenException({
      code: 'WORKSPACE_MANAGEMENT_FORBIDDEN',
      message:
        'La gestion de ce workspace est réservée aux administrateurs de Confluent et à ses gestionnaires.',
    }),
  administratorsOnly: () =>
    new ForbiddenException({
      code: 'WORKSPACE_ADMINISTRATION_FORBIDDEN',
      message:
        'La création et la liste de tous les workspaces sont réservées aux administrateurs de Confluent.',
    }),
  emailDomainReserved: () =>
    new ForbiddenException({
      code: 'WORKSPACE_EMAIL_DOMAIN_RESERVED',
      message:
        'Seul un administrateur de Confluent peut modifier le domaine email autorisé : il borne les invitations des gestionnaires.',
    }),
  // The same answer for a workspace that does not exist and one the account may not enter (E05.03).
  notFound: () =>
    new NotFoundException({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace introuvable, ou vous n’en êtes pas membre.',
    }),
  memberNotFound: () =>
    new NotFoundException({ code: 'WORKSPACE_MEMBER_NOT_FOUND', message: 'Membre introuvable.' }),
  alreadyMember: (deactivated: boolean) =>
    new ConflictException({
      code: 'WORKSPACE_MEMBER_EXISTS',
      message: deactivated
        ? 'Cette personne est déjà membre de ce workspace, avec une appartenance désactivée : réactivez-la plutôt que de l’inviter.'
        : 'Cette personne est déjà membre de ce workspace.',
    }),
  lastManager: () =>
    new ConflictException({
      code: 'WORKSPACE_LAST_MANAGER',
      message:
        'Vous êtes le dernier gestionnaire de ce workspace : donnez d’abord le droit de gestion à un autre conseiller.',
    }),
  emailDomainMismatch: (domain: string) =>
    new BadRequestException({
      code: 'WORKSPACE_EMAIL_DOMAIN_MISMATCH',
      message: `Les conseillers de ce workspace ont une adresse @${domain} : invitez une adresse de ce domaine.`,
      details: [{ path: ['email'], message: `Adresse @${domain} attendue pour un conseiller.` }],
    }),
  memberRule: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: [path], message }],
    }),
  slugTaken: (slug: string) =>
    new ConflictException({
      code: 'WORKSPACE_SLUG_TAKEN',
      message: `Le slug « ${slug} » est déjà utilisé par un autre workspace.`,
    }),
  slugRequired: () =>
    new BadRequestException({
      code: 'WORKSPACE_SLUG_REQUIRED',
      message: 'Aucun slug valide ne se déduit de ce nom : indiquez le slug du workspace.',
    }),
  logoRequired: () =>
    new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choisissez une image de logo.' }),
  logoTooLarge: () =>
    new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Logo trop volumineux : 1 Mo maximum.',
    }),
  logoType: () =>
    new UnsupportedMediaTypeException({
      code: 'UNSUPPORTED_LOGO_TYPE',
      message: `Format de logo non accepté. Formats acceptés : ${WORKSPACE_LOGO_FORMATS_LABEL}.`,
    }),
  storageFull: () =>
    new HttpException(
      {
        code: 'STORAGE_FULL',
        message:
          "L'espace de stockage est plein : le logo n'a pas été enregistré. Contactez l'équipe Confluent.",
      },
      507,
    ),
  storageUnavailable: () =>
    new ServiceUnavailableException({
      code: 'STORAGE_UNAVAILABLE',
      message:
        "Le stockage est momentanément indisponible : le logo n'a pas été enregistré. Réessayez dans quelques instants.",
    }),
}
