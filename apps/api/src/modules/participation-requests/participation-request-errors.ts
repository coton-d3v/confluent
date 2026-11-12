import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common'
import type { FormTokenCheck } from './participation-form-token'

// Errors of the public participation form (ROADMAP E08.04), with messages shown as is in the site.
// None depends on the address typed: whether it is known, already asked or set aside is never told.
export const ParticipationRequestErrors = {
  // The same answer for a workspace that does not exist and one that offers no committee.
  notFound: () =>
    new NotFoundException({
      code: 'PARTICIPATION_FORM_NOT_FOUND',
      message: 'Aucune session n’est ouverte aux demandes de participation à cette adresse.',
    }),
  form: (check: Exclude<FormTokenCheck, 'valid'>) =>
    new BadRequestException({
      code: 'PARTICIPATION_FORM_REFUSED',
      message:
        check === 'too_fast'
          ? 'Le formulaire a été envoyé trop vite : patientez quelques secondes, puis envoyez-le de nouveau.'
          : 'Le formulaire a expiré : rechargez la page, puis envoyez-le de nouveau.',
      details: { reason: check === 'too_fast' ? 'form_too_fast' : 'form_expired' },
    }),
  // Only identifiers the sender gave: the sessions offered are public anyway.
  committeesClosed: (committeeIds: string[]) =>
    new ConflictException({
      code: 'PARTICIPATION_COMMITTEES_CLOSED',
      message:
        'Une session choisie n’est plus ouverte aux demandes de participation : rechargez la page pour voir les sessions ouvertes.',
      details: { committeeIds },
    }),
  tooManyFromNetwork: () =>
    new HttpException(
      {
        code: 'PARTICIPATION_RATE_LIMIT',
        message: 'Trop de demandes envoyées depuis votre connexion : réessayez dans une heure.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
  queueFull: () =>
    new ServiceUnavailableException({
      code: 'PARTICIPATION_QUEUE_FULL',
      message:
        'Cette structure ne peut pas recevoir de nouvelle demande pour le moment : réessayez plus tard.',
    }),
}
