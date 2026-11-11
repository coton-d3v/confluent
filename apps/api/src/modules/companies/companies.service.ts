import { Injectable } from '@nestjs/common'
import type { Company, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CompanyErrors, assertCanOwnCompanies } from './company-access'

export interface CompanyDossierView {
  id: string
  slug: string
  name: string
  submittedAt: Date | null
  createdAt: Date
}

// What the owner reads of a company (@confluent/shared `companySchema`).
export interface CompanyView {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  dossiers: CompanyDossierView[]
}

type CompanyWithDossiers = Company & { dossiers: CompanyDossierView[] }

const WITH_DOSSIERS = {
  dossiers: {
    select: { id: true, slug: true, name: true, submittedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.CompanyInclude

// Companies and their owner (ROADMAP E05.04). Only the owner reads a company: there is no other
// reader yet (a financeur reaches a dossier through its share, an administrator through the admin
// screens); conseillers and workspaces come with E05.07–E05.09.
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  // Within the transaction that creates its first dossier: a company never exists without one
  // until E05.05 gives it a profile of its own.
  createForOwner(
    tx: Prisma.TransactionClient,
    owner: { id: string; role: string },
    name: string,
  ): Promise<Company> {
    assertCanOwnCompanies(owner)
    return tx.company.create({ data: { ownerId: owner.id, name } })
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
      submittedAt: d.submittedAt,
      createdAt: d.createdAt,
    })),
  }
}
