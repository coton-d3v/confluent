import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { CANDIDATURE_NOTE_LIMITS } from '@confluent/shared'

// Errors of a candidature's internal notes (ROADMAP E06.08), with messages shown as is in the site.
// Reaching the candidature is refused with the candidatures' errors.
export const CandidatureNoteErrors = {
  // The same answer for a note that does not exist and one of another candidature.
  notFound: () =>
    new NotFoundException({
      code: 'CANDIDATURE_NOTE_NOT_FOUND',
      message: 'Note introuvable sur cette candidature.',
    }),
  notAuthor: () =>
    new ForbiddenException({
      code: 'CANDIDATURE_NOTE_NOT_AUTHOR',
      message: 'Seul l’auteur d’une note peut la modifier ou la supprimer.',
    }),
  deleted: () =>
    new ConflictException({
      code: 'CANDIDATURE_NOTE_DELETED',
      message: 'Cette note a été supprimée.',
    }),
  tooMany: () =>
    new ConflictException({
      code: 'CANDIDATURE_NOTE_LIMIT',
      message: `Une candidature compte au plus ${CANDIDATURE_NOTE_LIMITS.perCandidature} notes internes.`,
    }),
  // The author changed or deleted the note since the client read it: nothing is overwritten.
  changed: (current: number) =>
    new ConflictException({
      code: 'CANDIDATURE_NOTE_CHANGED',
      message:
        'Cette note a été modifiée entre-temps : rechargez le journal avant de la modifier à nouveau.',
      details: { currentVersion: current },
    }),
}
