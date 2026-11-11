import { Injectable } from '@nestjs/common'
import {
  financingTypesOf,
  type DossierPublicationStatus,
  type FinancingType,
} from '@confluent/shared'
import type { Company, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CompanyErrors, assertCanOwnCompanies } from './company-access'

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

// What the owner reads of a company (@confluent/shared `companySchema`).
export interface CompanyView {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  dossiers: CompanyDossierView[]
}

type CompanyWithDossiers = Company & { dossiers: DossierRow[] }

const WITH_DOSSIERS = {
  dossiers: { select: DOSSIER_COLUMNS, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.CompanyInclude

// Companies and their owner (ROADMAP E05.04). Only the owner reads a company: there is no other
// reader yet (a financeur reaches a dossier through its share, an administrator through the admin
// screens); conseillers and workspaces come with E05.08–E05.09. A company makes several financing
// requests, its dossiers (E05.07).
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

  async listForOwner(user: { id: string }): Promise<CompanyView[]> {
    const rows = await this.prisma.company.findMany({
      where: { ownerId: user.id },
      include: WITH_DOSSIERS,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toView)
  }

  async getForOwner(id: string, user: { id: string }): Promise<CompanyView> {
    const company = await this.prisma.company.findUnique({ where: { id }, include: WITH_DOSSIERS })
    if (!company || company.ownerId !== user.id) throw CompanyErrors.notFound()
    return toView(company)
  }

  // The company row, for its owner only: the same 404 for another account's company and an unknown
  // one (a malformed id included).
  async findOwned(id: string, user: { id: string }): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } })
    if (!company || company.ownerId !== user.id) throw CompanyErrors.notFound()
    return company
  }
}

// Explicit fields: the owner's identifier and any column added later stay out of the response.
function toView(company: CompanyWithDossiers): CompanyView {
  return {
    id: company.id,
    name: company.name,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
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
