import { BadRequestException, ConflictException } from '@nestjs/common'

// Errors of a request's public card (ROADMAP E09.02), with messages shown as is in the site. What
// stands in the way of a consent is the pool's (`poolPublicationBlocked`, E07.02).
export const ShowcaseCardErrors = {
  changed: (current: number | null) =>
    new ConflictException({
      code: 'SHOWCASE_CARD_CHANGED',
      message:
        'La carte de la page publique a été modifiée entre-temps : rechargez-la avant de la modifier.',
      details: { currentVersion: current },
    }),
  revealsName: () =>
    new BadRequestException({
      code: 'PSEUDONYM_REVEALS_NAME',
      message:
        'Choisissez un pseudonyme différent du nom de l’entreprise, du titre de la demande et de votre nom.',
    }),
}
