import { Injectable } from '@nestjs/common'
import {
  financingTypesOf,
  type DossierPublicationStatus,
  type FinancingType,
} from '@confluent/shared'
import type { Company, CompanyTransfer, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { invitationView, type TransferInvitationView } from '../company-transfers/transfer-view'
import {
  CompanyErrors,
  assertCanOwnCompanies,
  holdsCompany,
  userHoldsCompany,
} from './company-access'

// A financing request as listed under its company (E05.07).
export interface CompanyDossierView {
  id: string
  slug: string
  name: string
  summary: string | null
  amountEur: number | null
  financingTypes: FinancingType[]
  publicationStatus: DossierPublicationStatus
  publishedAt: Date | null
  submittedAt: Date | null
  createdAt: Date
}

const DOSSIER_COLUMNS = {
  id: true,
  slug: true,
  name: true,
  summary: true,
  amountEur: true,
  financingTypes: true,
  publicationStatus: true,
  publishedAt: true,
  submittedAt: true,
  createdAt: true,
} satisfies Prisma.DossierSelect

type DossierRow = Prisma.DossierGetPayload<{ select: typeof DOSSIER_COLUMNS }>

// E05.08: what the conseiller holding a prepared company reads of its preparation.
export interface CompanyPreparationView {
  workspace: { id: string; name: string }
  invitation: TransferInvitationView | null
}

// What the owner reads of a company (@confluent/shared `companySchema`).
export interface CompanyView {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  dossiers: CompanyDossierView[]
  preparation: CompanyPreparationView | null
}

type CompanyWithDossiers = Company & {
  dossiers: DossierRow[]
  preparedInWorkspace: { id: string; name: string } | null
  transfers: CompanyTransfer[]
}

const WITH_DOSSIERS = {
  dossiers: { select: DOSSIER_COLUMNS, orderBy: { createdAt: 'desc' } },
  preparedInWorkspace: { select: { id: true, name: true } },
  // The latest invitation (E05.08).
  transfers: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.CompanyInclude

// Companies and their owner (ROADMAP E05.04). Only the owner reads a company — for a company a
// conseiller prepares for an entrepreneur (E05.08), that conseiller while an active conseiller of its
// workspace (`holdsCompany`) —: a financeur reaches a dossier through its share, an administrator
// through the admin screens. A company makes several financing requests, its dossiers (E05.07).
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  // Within the transaction that creates its first dossier: a company never exists without one (its
  // profile and library are reached through its dossiers). Its profile answers `profileVersionId`,
  // the form version assigned to company profiles (E03.09).
  createForOwner(
    tx: Prisma.TransactionClient,
    owner: { id: string; role: string },
    name: string,
    profileVersionId: string,
  ): Promise<Company> {
    assertCanOwnCompanies(owner)
    return tx.company.create({ data: { ownerId: owner.id, name, profileVersionId } })
  }

  // Companies prepared in a workspace the account no longer prepares in are left out.
  async listForOwner(user: { id: string }): Promise<CompanyView[]> {
    const rows = await this.prisma.company.findMany({
      where: { ownerId: user.id },
      include: WITH_DOSSIERS,
      orderBy: { createdAt: 'desc' },
    })
    const held = await this.heldOnly(user, rows)
    return held.map((row) => toView(row))
  }

  async getForOwner(id: string, user: { id: string }): Promise<CompanyView> {
    const company = await this.prisma.company.findUnique({ where: { id }, include: WITH_DOSSIERS })
    if (!company || !(await userHoldsCompany(this.prisma, user, company))) {
      throw CompanyErrors.notFound()
    }
    return toView(company)
  }

  // The company row, for its owner only (`holdsCompany`): the same 404 for another account's
  // company and an unknown one (a malformed id included).
  async findOwned(id: string, user: { id: string }): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } })
    if (!company || !(await userHoldsCompany(this.prisma, user, company))) {
      throw CompanyErrors.notFound()
    }
    return company
  }

  // The companies among `rows` (all owned by `user`) the account works on: one query for the
  // memberships of the workspaces its prepared companies belong to, if any.
  async heldOnly<T extends Pick<Company, 'ownerId' | 'preparedInWorkspaceId'>>(
    user: { id: string },
    rows: T[],
  ): Promise<T[]> {
    const workspaceIds = [
      ...new Set(rows.map((r) => r.preparedInWorkspaceId).filter((id): id is string => !!id)),
    ]
    if (workspaceIds.length === 0) return rows.filter((r) => r.ownerId === user.id)
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId: user.id, workspaceId: { in: workspaceIds } },
    })
    const byWorkspace = new Map(memberships.map((m) => [m.workspaceId, m]))
    return rows.filter((r) =>
      holdsCompany(
        user,
        r,
        r.preparedInWorkspaceId ? (byWorkspace.get(r.preparedInWorkspaceId) ?? null) : null,
      ),
    )
  }
}

// Explicit fields: the owner's identifier and any column added later stay out of the response.
function toView(company: CompanyWithDossiers): CompanyView {
  return {
    id: company.id,
    name: company.name,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    preparation: company.preparedInWorkspace
      ? {
          workspace: { id: company.preparedInWorkspace.id, name: company.preparedInWorkspace.name },
          invitation: company.transfers[0] ? invitationView(company.transfers[0]) : null,
        }
      : null,
    dossiers: company.dossiers.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      summary: d.summary,
      amountEur: d.amountEur,
      financingTypes: financingTypesOf(d.financingTypes),
      publicationStatus: d.publicationStatus === 'published' ? 'published' : 'draft',
      publishedAt: d.publishedAt,
      submittedAt: d.submittedAt,
      createdAt: d.createdAt,
    })),
  }
}
