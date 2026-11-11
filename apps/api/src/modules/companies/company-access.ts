import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { canOwnCompanies } from '@confluent/shared'

// Who may own a company and its dossiers (ROADMAP E05.04): the single rule `canOwnCompanies` of
// @confluent/shared, closed by default. Preparing a company on behalf of an entrepreneur is E05.08.
export { canOwnCompanies }

export const CompanyErrors = {
  ownersOnly: () =>
    new ForbiddenException({
      code: 'COMPANY_OWNERS_ONLY',
      message: 'Seuls les porteurs de projet créent une entreprise et ses dossiers.',
    }),
  // The same answer for a company that does not exist and one of another account.
  notFound: () =>
    new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Entreprise introuvable.' }),
}

export function assertCanOwnCompanies(user: { role: string }): void {
  if (!canOwnCompanies(user)) throw CompanyErrors.ownersOnly()
}
