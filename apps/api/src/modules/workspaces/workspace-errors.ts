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
      message: 'La gestion des workspaces est réservée aux administrateurs de Confluent.',
    }),
  notFound: () =>
    new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace introuvable.' }),
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
