import { ConflictException, Injectable } from '@nestjs/common'
import { isArchived, type MarkInterestInput } from '@confluent/shared'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DossiersService } from '../dossiers/dossiers.service'
import {
  OpportunitiesService,
  interestIdentity,
  interestView,
  opportunityNotFound,
  type InterestIdentityView,
  type OpportunityInterestView,
  type OpportunityReader,
} from './opportunities.service'

// @confluent/shared `dossierInterestsSchema`.
export interface DossierInterestsView {
  count: number
  named: Array<InterestIdentityView & { markedAt: Date }>
}

const interestArchived = () =>
  new ConflictException({
    code: 'OPPORTUNITY_ARCHIVED',
    message:
      'Cette demande est archivée par son porteur : vous ne pouvez plus y marquer votre intérêt ni y montrer votre nom.',
  })

// The request's row, held for the rest of the transaction: who reads it changes under the same lock
// (shares E07.01, pool publications E07.02, archiving E06.01), so a mark is decided on who reads it
// once those changes are committed, and two marks of the same investor — a double click, two tabs —
// follow one another. No owner check: the reader is no owner (`OpportunitiesService.reachOne` decides).
async function lockRequest(tx: Prisma.TransactionClient, dossierId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossierId} FOR UPDATE`
}

// ROADMAP E07.05 — marks of interest (rules in @confluent/shared `interest.schema.ts`). An investor
// marks a request they read as an opportunity right now — THE rule of `GET /v1/opportunities/:id`
// (`OpportunitiesService.reachOne`), nothing else —; its owner reads how many investors who still read
// it marked it, and the names of those who chose to show theirs (D05). Every change is journaled in
// its transaction; the journal entries stay hidden from the owner (`AuditLogService`).
@Injectable()
export class InterestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
    private readonly dossiers: DossiersService,
    private readonly audit: AuditService,
  ) {}

  // Marks the reader's interest, or changes whether their name shows on it. The same answer changes
  // nothing and journals nothing. A request the reader does not reach is the opportunity's `404`; an
  // archived one takes no new mark nor a name newly shown (`409`), hiding one's name stays possible.
  async mark(
    reader: OpportunityReader,
    dossierId: string,
    input: MarkInterestInput,
  ): Promise<OpportunityInterestView> {
    return this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, dossierId)
      const found = await this.opportunities.reachOne(reader, dossierId, tx)
      if (!found) throw opportunityNotFound()
      const key = { dossierId_investorId: { dossierId, investorId: reader.id } }
      const current = await tx.investorInterest.findUnique({ where: key })
      if (current && current.nameVisible === input.nameVisible) return interestView(current)
      if ((!current || input.nameVisible) && isArchived(found.dossier)) throw interestArchived()
      const mark = current
        ? await tx.investorInterest.update({
            where: { id: current.id },
            data: { nameVisible: input.nameVisible },
          })
        : await tx.investorInterest.create({
            data: { dossierId, investorId: reader.id, nameVisible: input.nameVisible },
          })
      await this.audit.recordIn(tx, {
        actionType: 'investor_interest_marked',
        actorId: reader.id,
        dossierId,
        metadata: {
          change: !current ? 'marked' : input.nameVisible ? 'name_shown' : 'name_hidden',
          nameVisible: input.nameVisible,
          accessLevel: found.accessLevel,
        },
      })
      return interestView(mark)
    })
  }

  // Withdraws the reader's mark, whether they still read the request or not: it only removes their own
  // data, and the answer is the same `204` with or without a mark, for any request.
  async withdraw(reader: OpportunityReader, dossierId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, dossierId)
      const key = { dossierId_investorId: { dossierId, investorId: reader.id } }
      const current = await tx.investorInterest.findUnique({ where: key })
      if (!current || current.investorId !== reader.id) return
      await tx.investorInterest.delete({ where: { id: current.id } })
      await this.audit.recordIn(tx, {
        actionType: 'investor_interest_withdrawn',
        actorId: reader.id,
        dossierId,
        metadata: { nameVisible: current.nameVisible },
      })
    })
  }

  // What the owner reads (D05): the marks of the investors who read the request as an opportunity
  // now — an active account, reaching it by THE rule — counted, and named only when they chose so.
  // Anyone but the owner: the dossier's `404`.
  async forOwner(dossierId: string, ownerId: string): Promise<DossierInterestsView> {
    await this.dossiers.getByIdForUser(dossierId, ownerId)
    const marks = await this.prisma.investorInterest.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'desc' },
    })
    const investors =
      marks.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: marks.map((m) => m.investorId) } },
          })
    const investorById = new Map(investors.map((u) => [u.id, u]))

    let count = 0
    const named: DossierInterestsView['named'] = []
    for (const mark of marks) {
      if (mark.dossierId !== dossierId) continue
      const investor = investorById.get(mark.investorId)
      if (!investor || !investor.isActive || investor.emailVerifiedAt === null) continue
      const reached = await this.opportunities.reachOne(investor, dossierId)
      if (!reached) continue
      count += 1
      if (mark.nameVisible) {
        named.push({
          ...interestIdentity(investor, reached.organizations),
          markedAt: mark.createdAt,
        })
      }
    }
    named.sort((a, b) => b.markedAt.getTime() - a.markedAt.getTime())
    return { count, named }
  }
}
