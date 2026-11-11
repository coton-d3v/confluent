import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common'

// Errors of companies prepared for entrepreneurs and of their transfer (ROADMAP E05.08), with
// messages shown as is in the site.
export const CompanyTransferErrors = {
  conseillersOnly: () =>
    new ForbiddenException({
      code: 'COMPANY_PREPARATION_FORBIDDEN',
      message:
        'Seuls les conseillers de ce workspace préparent des entreprises pour des entrepreneurs.',
    }),
  // The same answer for a company that does not exist, one prepared in another workspace and one
  // another conseiller holds.
  preparedCompanyNotFound: () =>
    new NotFoundException({
      code: 'PREPARED_COMPANY_NOT_FOUND',
      message: 'Entreprise introuvable parmi celles que vous préparez dans ce workspace.',
    }),
  selfInvitation: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message:
        'Indiquez l’adresse de l’entrepreneur : vous ne pouvez pas vous proposer l’entreprise.',
      details: [{ path: ['email'], message: 'Adresse de l’entrepreneur attendue.' }],
    }),
  // The same answer for an unknown invitation and one addressed to another account.
  invitationNotFound: () =>
    new NotFoundException({
      code: 'COMPANY_TRANSFER_NOT_FOUND',
      message: 'Proposition introuvable.',
    }),
  alreadyDecided: (status: 'accepted' | 'declined') =>
    new ConflictException({
      code: 'COMPANY_TRANSFER_DECIDED',
      message:
        status === 'accepted'
          ? 'Vous avez déjà accepté cette proposition : l’entreprise est à vous.'
          : 'Vous avez déjà refusé cette proposition.',
    }),
  closed: () =>
    new GoneException({
      code: 'COMPANY_TRANSFER_CLOSED',
      message:
        'Cette proposition n’est plus valable : elle a expiré ou le conseiller l’a retirée. Demandez-lui de vous en envoyer une nouvelle.',
    }),
  cannotOwn: () =>
    new ForbiddenException({
      code: 'COMPANY_OWNERS_ONLY',
      message:
        'Votre compte ne peut pas posséder d’entreprise : refusez la proposition, ou demandez à l’équipe Confluent un compte de porteur de projet.',
    }),
}
