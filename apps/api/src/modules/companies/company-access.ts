import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { canOwnCompanies, canPrepareCompanies } from '@confluent/shared'
import type { Prisma } from '@prisma/client'
import { isActiveMembership } from '../workspaces/workspace-access'

// Who may own a company and its dossiers (ROADMAP E05.04): the single rule `canOwnCompanies` of
// @confluent/shared, closed by default. A conseiller holds a company prepared for an entrepreneur
// by the workspace rule below instead (E05.08).
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
  // E05.08: diffusing a company is its entrepreneur's decision, once they own it.
  inPreparation: () =>
    new ConflictException({
      code: 'COMPANY_IN_PREPARATION',
      message:
        'Cette entreprise est préparée pour un entrepreneur : seul son propriétaire, après avoir accepté la proposition, pourra partager ou publier ses demandes.',
    }),
}

export function assertCanOwnCompanies(user: { role: string }): void {
  if (!canOwnCompanies(user)) throw CompanyErrors.ownersOnly()
}

// What decides whether an account works on a company as its owner.
export interface HeldCompany {
  ownerId: string
  preparedInWorkspaceId: string | null
}

// THE rule of who works on a company as its owner — its profile, library, requests (E05.04,
// E05.08): its owner; for a company prepared in a workspace, its owner (the conseiller who holds it)
// only while an active conseiller of that workspace. Closed by default: a deactivated membership, an
// investisseur or an unknown role hold nothing, and the conseiller's global role is never looked at.
// `membership`: the owner's membership in the workspace the company is prepared in, if any.
export function holdsCompany(
  user: { id: string },
  company: HeldCompany,
  membership: { role: string; deactivatedAt: Date | null } | null,
): boolean {
  if (company.ownerId !== user.id) return false
  if (company.preparedInWorkspaceId === null) return true
  return membership !== null && isActiveMembership(membership) && canPrepareCompanies(membership)
}

// The rule above, reading the membership it needs (prepared companies only) from the database at
// each request. `tx`: inside a transaction, after its locks.
export async function userHoldsCompany(
  tx: Prisma.TransactionClient,
  user: { id: string },
  company: HeldCompany,
): Promise<boolean> {
  if (company.ownerId !== user.id) return false
  const membership =
    company.preparedInWorkspaceId === null
      ? null
      : await tx.workspaceMembership.findUnique({
          where: {
            workspaceId_userId: { workspaceId: company.preparedInWorkspaceId, userId: user.id },
          },
        })
  return holdsCompany(user, company, membership)
}
