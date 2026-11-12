import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { FormTokenCheck } from '../participation-requests/participation-form-token'

// Errors of the public access request form (ROADMAP E09.05) and of the managers' decisions, with
// messages shown as is in the site. None of the public form's depends on the address typed: whether
// it is known, already asked or set aside is never told.
export const EntrepreneurAccessErrors = {
  // The same answer for a workspace that does not exist and one whose page does not offer the form
  // (unpublished, « apply » block hidden, no candidature form published).
  notFound: () =>
    new NotFoundException({
      code: 'ENTREPRENEUR_ACCESS_FORM_NOT_FOUND',
      message: 'Aucune structure ne reçoit de demande d’accès à cette adresse.',
    }),
  form: (check: Exclude<FormTokenCheck, 'valid'>) =>
    new BadRequestException({
      code: 'ENTREPRENEUR_ACCESS_FORM_REFUSED',
      message:
        check === 'too_fast'
          ? 'Le formulaire a été envoyé trop vite : patientez quelques secondes, puis envoyez-le de nouveau.'
          : 'Le formulaire a expiré : rechargez la page, puis envoyez-le de nouveau.',
      details: { reason: check === 'too_fast' ? 'form_too_fast' : 'form_expired' },
    }),
  tooManyFromNetwork: () =>
    new HttpException(
      {
        code: 'ENTREPRENEUR_ACCESS_RATE_LIMIT',
        message: 'Trop de demandes envoyées depuis votre connexion : réessayez dans une heure.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
  queueFull: () =>
    new ServiceUnavailableException({
      code: 'ENTREPRENEUR_ACCESS_QUEUE_FULL',
      message:
        'Cette structure ne peut pas recevoir de nouvelle demande pour le moment : réessayez plus tard.',
    }),
  // ── The managers' decisions ──
  requestNotFound: () =>
    new NotFoundException({
      code: 'ENTREPRENEUR_ACCESS_REQUEST_NOT_FOUND',
      message: 'Demande d’accès introuvable dans ce workspace.',
    }),
  changed: () =>
    new ConflictException({
      code: 'ENTREPRENEUR_ACCESS_REQUEST_CHANGED',
      message:
        'La demande a changé depuis son affichage (nouvel envoi de la personne) : rechargez-la, puis décidez de nouveau.',
    }),
  decided: (status: 'accepted' | 'refused') =>
    new ConflictException({
      code: 'ENTREPRENEUR_ACCESS_REQUEST_DECIDED',
      message: `Cette demande a déjà été ${status === 'accepted' ? 'acceptée' : 'refusée'} : une décision est définitive.`,
      details: { status },
    }),
  // An acceptance never changes an existing account's role nor reactivates it.
  accountUnsuitable: () =>
    new ConflictException({
      code: 'ENTREPRENEUR_ACCESS_ACCOUNT_UNSUITABLE',
      message:
        'Cette adresse est celle d’un compte Confluent qui ne peut pas présenter de demande de financement (autre rôle, ou compte désactivé) : une acceptation ne change pas un compte existant. Refusez la demande, ou demandez à un administrateur de Confluent d’examiner ce compte.',
    }),
  candidaturesClosed: () =>
    new ConflictException({
      code: 'ENTREPRENEUR_ACCESS_CANDIDATURES_CLOSED',
      message:
        'Le workspace ne reçoit plus de candidature (aucun formulaire de candidature publié) : publiez-en un avant d’accepter, ou refusez la demande.',
    }),
}
