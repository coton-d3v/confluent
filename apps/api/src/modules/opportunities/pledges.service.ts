import { ConflictException, Injectable } from '@nestjs/common'
import { isArchived, type PledgeInputParsed } from '@confluent/shared'
import type { InvestorPledge, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DossiersService } from '../dossiers/dossiers.service'
import {
  OpportunitiesService,
  interestIdentity,
  lockRequest,
  opportunityNotFound,
  pledgeView,
  type InterestIdentityView,
  type OpportunityPledgeView,
  type OpportunityReader,
} from './opportunities.service'

// @confluent/shared `dossierPledgesSchema`.
export interface DossierPledgesView {
  count: number
  totalEur: number
  shown: Array<{ identity: InterestIdentityView | null; amountEur: number | null }>
}

// The pledge as the investor wants it: the body, its comment absent meaning none.
type Wanted = Omit<PledgeInputParsed, 'comment'> & { comment: string | null }

const pledgeClosed = (what: 'new' | 'existing') =>
  new ConflictException({
    code: 'PLEDGE_CLOSED',
    message:
      what === 'new'
        ? 'Cette demande est archivée par son porteur : elle ne reçoit plus de promesse.'
        : 'Cette demande est archivée par son porteur : votre promesse est close, elle ne peut plus être modifiée ni retirée. Vous pouvez toujours masquer votre nom ou votre montant.',
  })

const pledgeChanged = () =>
  new ConflictException({
    code: 'PLEDGE_CHANGED',
    message:
      'Votre promesse a changé entre-temps (dans un autre onglet ?) : rechargez la page pour repartir de la version enregistrée.',
  })

const sameContent = (p: InvestorPledge, w: Wanted) =>
  p.intention === w.intention && p.amountEur === w.amountEur && p.comment === w.comment

// Only hides what was shown — the name, the amount or both —, the rest unchanged: a consent the
// investor may always take back, even on a closed request or one they no longer read.
const onlyHides = (p: InvestorPledge, w: Wanted) =>
  sameContent(p, w) &&
  (p.showName || !w.showName) &&
  (p.showAmount || !w.showAmount) &&
  (p.showName !== w.showName || p.showAmount !== w.showAmount)

// The revision a pledge is written at: drawn from one sequence for every pledge, never reused — not
// even by a pledge made again after a withdrawal, which a tab still holding the withdrawn pledge's
// revision must not overwrite (code review R63).
async function nextRevision(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ revision: number }>>`
    SELECT nextval('investor_pledge_revisions')::int AS revision`
  return row.revision
}

const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

// ROADMAP E07.06 — pledges (rules in @confluent/shared `pledge.schema.ts`). An investor pledges on a
// request they read as an opportunity right now — THE rule of `GET /v1/opportunities/:id`
// (`OpportunitiesService.reachOne`), the one of a mark of interest — and changes it from the version
// they read until the request is closed (archived); its owner reads the count and total of the
// pledges of investors who still read it, and what each chose to show. Every change is journaled in
// its transaction; the journal entries stay hidden from the owner (`AuditLogService`).
@Injectable()
export class PledgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
    private readonly dossiers: DossiersService,
    private readonly audit: AuditService,
  ) {}

  // Makes or changes the reader's pledge. The pledge already recorded changes nothing and journals
  // nothing (a double click). Otherwise, from the version read (`409 PLEDGE_CHANGED`): hiding one's
  // name or amount is always possible; anything else needs the request read now (the opportunity's
  // `404`) and not archived (`409 PLEDGE_CLOSED`).
  async set(
    reader: OpportunityReader,
    dossierId: string,
    input: PledgeInputParsed,
  ): Promise<OpportunityPledgeView> {
    const wanted: Wanted = { ...input, comment: input.comment ?? null }
    return this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, dossierId)
      const key = { dossierId_investorId: { dossierId, investorId: reader.id } }
      const found = await tx.investorPledge.findUnique({ where: key })
      const current = found && found.investorId === reader.id ? found : null
      if (
        current &&
        sameContent(current, wanted) &&
        current.showName === wanted.showName &&
        current.showAmount === wanted.showAmount
      ) {
        return pledgeView(current)
      }
      if ((current?.version ?? null) !== wanted.version) throw pledgeChanged()

      let accessLevel: string | null = null
      if (!(current && onlyHides(current, wanted))) {
        const reached = await this.opportunities.reachOne(reader, dossierId, tx)
        if (!reached) throw opportunityNotFound()
        if (isArchived(reached.dossier)) throw pledgeClosed(current ? 'existing' : 'new')
        accessLevel = reached.accessLevel
      }

      const data = {
        intention: wanted.intention,
        amountEur: wanted.amountEur,
        comment: wanted.comment,
        showName: wanted.showName,
        showAmount: wanted.showAmount,
      }
      const pledge = current
        ? await tx.investorPledge.update({
            where: { id: current.id },
            data: { ...data, version: await nextRevision(tx) },
          })
        : await tx.investorPledge.create({
            data: { ...data, dossierId, investorId: reader.id, version: await nextRevision(tx) },
          })
      // The comment's text stays out of the journal, which administrators read.
      await this.audit.recordIn(tx, {
        actionType: 'investor_pledge_set',
        actorId: reader.id,
        dossierId,
        metadata: {
          change: !current ? 'pledged' : accessLevel === null ? 'hidden' : 'changed',
          intention: pledge.intention,
          amountEur: pledge.amountEur,
          hasComment: pledge.comment !== null,
          showName: pledge.showName,
          showAmount: pledge.showAmount,
          version: pledge.version,
          accessLevel,
        },
      })
      return pledgeView(pledge)
    })
  }

  // Withdraws the reader's pledge, whether they still read the request or not — it only removes their
  // own data —, until the request is closed (archived: `409 PLEDGE_CLOSED`). The same `204` without
  // a pledge, for any request.
  async withdraw(reader: OpportunityReader, dossierId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, dossierId)
      const key = { dossierId_investorId: { dossierId, investorId: reader.id } }
      const current = await tx.investorPledge.findUnique({ where: key })
      if (!current || current.investorId !== reader.id) return
      const dossier = await tx.dossier.findUnique({ where: { id: dossierId } })
      if (dossier && isArchived(dossier)) throw pledgeClosed('existing')
      await tx.investorPledge.delete({ where: { id: current.id } })
      await this.audit.recordIn(tx, {
        actionType: 'investor_pledge_withdrawn',
        actorId: reader.id,
        dossierId,
        metadata: {
          intention: current.intention,
          amountEur: current.amountEur,
          showName: current.showName,
          showAmount: current.showAmount,
          version: current.version,
        },
      })
    })
  }

  // What the owner reads: the pledges of the investors who read the request as an opportunity now
  // (`OpportunitiesService.readersNow`, as for the marks of interest) — counted and totalled —, and
  // for each of them who shows their name or amount, what they show. Never the intention, the
  // comment or a date. Anyone but the owner: the dossier's `404`.
  async forOwner(dossierId: string, ownerId: string): Promise<DossierPledgesView> {
    await this.dossiers.getByIdForUser(dossierId, ownerId)
    const pledges = await this.prisma.investorPledge.findMany({ where: { dossierId } })
    const readers = await this.opportunities.readersNow(
      dossierId,
      pledges.map((p) => p.investorId),
    )

    let count = 0
    let totalEur = 0
    const shown: DossierPledgesView['shown'] = []
    for (const pledge of pledges) {
      if (pledge.dossierId !== dossierId) continue
      const reader = readers.get(pledge.investorId)
      if (!reader) continue
      count += 1
      totalEur += pledge.amountEur
      if (!pledge.showName && !pledge.showAmount) continue
      shown.push({
        identity: pledge.showName
          ? interestIdentity(reader.investor, reader.reached.organizations)
          : null,
        amountEur: pledge.showAmount ? pledge.amountEur : null,
      })
    }
    // Nothing that follows the order of the pledges: the largest shown amounts first, then by name.
    shown.sort(
      (a, b) =>
        (b.amountEur ?? 0) - (a.amountEur ?? 0) ||
        byName.compare(a.identity?.name ?? '', b.identity?.name ?? ''),
    )
    return { count, totalEur, shown }
  }
}
