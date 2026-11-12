import { Injectable } from '@nestjs/common'
import {
  ENGAGING_COMMITTEE_APPLICATION_STATUSES,
  candidateCommitteeOf,
  committeeApplicationSideOf,
  committeeApplicationStatusOf,
  committeeApplicationTransition,
  committeeOpenToCandidates,
  committeeStatusOf,
  financingOpenToCommittees,
  financingStatusOf,
  isArchived,
  type ChangeCommitteeApplicationInput,
  type CommitteeApplicationSide,
  type CommitteeApplicationStatus,
  type CommitteeSharedField,
  type FinancingStatus,
} from '@confluent/shared'
import { Prisma, type Candidature, type Committee, type CommitteeApplication } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { type ActionOrigin, channelMetadata, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import { requestArchived } from '../dossiers/dossiers.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import { CommitteeApplicationErrors } from './committee-application-errors'
import { CommitteeErrors } from './committee-errors'
import { toView, type CommitteeView } from './committee-views'
import { CommitteesService } from './committees.service'

// @confluent/shared `ownerCommitteeApplicationSchema`: which side, never who among the structure.
export interface OwnerCommitteeApplicationView {
  id: string
  status: CommitteeApplicationStatus
  by: CommitteeApplicationSide
  changedAt: Date
  version: number
  createdAt: Date
}

// @confluent/shared `candidateCommitteeSchema`.
export interface CandidateCommitteeView {
  committee: Pick<CommitteeView, CommitteeSharedField>
  application: OwnerCommitteeApplicationView | null
}

// @confluent/shared `committeeApplicationSchema`.
export interface CommitteeApplicationView extends OwnerCommitteeApplicationView {
  committeeId: string
  changedBy: { email: string; firstName: string | null; lastName: string | null } | null
  candidature: {
    id: string
    financingStatus: FinancingStatus
    company: { name: string }
    dossier: { name: string }
  }
}

// What a change did — for the notifications to come (E08.06/E10.03), journaled as such.
export interface CommitteeApplicationChange {
  application: CommitteeApplication
  from: CommitteeApplicationStatus | null
  to: CommitteeApplicationStatus
  by: CommitteeApplicationSide
}

const COMMITTEE_ORDER = [{ startsAt: 'asc' as const }, { createdAt: 'asc' as const }]

// A request's entries on the committees of a workspace (ROADMAP E08.03, rules in @confluent/shared
// `committee-application.schema.ts`): its owner applies, confirms a proposal or withdraws; the
// workspace's side — whoever follows its candidatures — attaches the request, accepts or refuses an
// application, or withdraws. Each side reaches the candidature through `CandidaturesService.reachAs`
// (the owner access to the request; the workspace's read rule on a sent candidature of its own) and,
// inside the write, `lockAs`: the candidature's row is locked and the access read again after the
// lock, so both sides acting on one candidature run one after the other and an entry is created once.
// The committee's row is then held (FOR SHARE) and read: a committee cancelled or held meanwhile
// either waits for the change or is seen as such. Every change starts from the version the client
// read (`409` otherwise) and is journaled in the same transaction (`committee_application_changed`,
// attached to the request but kept out of its owner's history, E07.09).
//
// The owner reads a committee only through `candidateCommitteeOf` — the shared view of E08.02,
// never the internal notes, the link once accepted — and only the committees they may apply to or
// have an entry on; investors, other workspaces and other entrepreneurs have no route here.
//
// E08.07: the MCP tools call the same two operations, with the request's `origin` — the channel,
// the application and its authorization on the entry's journal, and the owner's own words
// (`instruction`); never a conseiller's (`channelMetadata`, see the call's own entry).
@Injectable()
export class CommitteeApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly committees: CommitteesService,
    private readonly audit: AuditService,
  ) {}

  // ── The owner of the request ─────────────────────────────────────────────────────────────────

  // The committees of the candidature's workspace its owner may apply to (planned, not started),
  // and those it has an entry on whatever their status, earliest first. Nothing for a draft.
  async listForOwner(userId: string, candidatureId: string): Promise<CandidateCommitteeView[]> {
    const candidature = await this.candidatures.reachAs({ side: 'owner', userId }, candidatureId)
    if (!candidature.submittedAt) return []
    const [committees, entries] = await Promise.all([
      this.prisma.committee.findMany({
        where: { workspaceId: candidature.workspaceId },
        orderBy: COMMITTEE_ORDER,
      }),
      this.prisma.committeeApplication.findMany({ where: { candidatureId: candidature.id } }),
    ])
    const entryOf = new Map(entries.map((e) => [e.committeeId, e]))
    const now = Date.now()
    return committees
      .filter((c) => entryOf.has(c.id) || committeeOpenToCandidates(c, now))
      .map((c) => candidateView(c, entryOf.get(c.id) ?? null))
  }

  async changeAsOwner(
    userId: string,
    candidatureId: string,
    committeeId: string,
    input: ChangeCommitteeApplicationInput,
    origin?: ActionOrigin,
  ): Promise<CandidateCommitteeView[]> {
    const party: CandidatureParty = { side: 'owner', userId }
    await this.candidatures.reachAs(party, candidatureId)
    await this.transition(
      party,
      candidatureId,
      committeeId,
      input,
      userId,
      origin ? originMetadata(origin) : {},
    )
    return this.listForOwner(userId, candidatureId)
  }

  // ── The workspace's side ─────────────────────────────────────────────────────────────────────

  // The entries of one committee, as the workspace's conseillers read it (the committee's read
  // rule: `403` for an investisseur, `404` outside the workspace or for another's committee).
  async listForCommittee(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
  ): Promise<CommitteeApplicationView[]> {
    await this.committees.get(actor, workspaceId, committeeId)
    const entries = await this.prisma.committeeApplication.findMany({
      where: { committeeId, workspaceId },
      orderBy: { createdAt: 'asc' },
    })
    if (entries.length === 0) return []
    const candidatures = await this.prisma.candidature.findMany({
      where: { id: { in: entries.map((e) => e.candidatureId) } },
    })
    const dossiers = await this.prisma.dossier.findMany({
      where: { id: { in: candidatures.map((c) => c.dossierId) } },
    })
    const [companies, actors] = await Promise.all([
      this.prisma.company.findMany({ where: { id: { in: dossiers.map((d) => d.companyId) } } }),
      this.prisma.user.findMany({
        where: { id: { in: entries.flatMap((e) => (e.statusActorId ? [e.statusActorId] : [])) } },
      }),
    ])
    const candidatureById = new Map(candidatures.map((c) => [c.id, c]))
    const dossierById = new Map(dossiers.map((d) => [d.id, d]))
    const companyById = new Map(companies.map((c) => [c.id, c]))
    const actorById = new Map(actors.map((u) => [u.id, u]))
    return entries.map((entry) => {
      const candidature = candidatureById.get(entry.candidatureId)!
      const dossier = dossierById.get(candidature.dossierId)!
      const actor = entry.statusActorId ? actorById.get(entry.statusActorId) : undefined
      return {
        ...ownerApplicationView(entry),
        committeeId: entry.committeeId,
        changedBy: actor
          ? { email: actor.email, firstName: actor.firstName, lastName: actor.lastName }
          : null,
        candidature: {
          id: candidature.id,
          financingStatus: financingStatusOf(candidature.financingStatus),
          company: { name: companyById.get(dossier.companyId)!.name },
          dossier: { name: dossier.name },
        },
      }
    })
  }

  async changeForWorkspace(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
    input: ChangeCommitteeApplicationInput & { candidatureId: string },
    origin?: ActionOrigin,
  ): Promise<CommitteeApplicationView[]> {
    const party: CandidatureParty = { side: 'workspace', actor, workspaceId }
    await this.candidatures.reachAs(party, input.candidatureId)
    await this.transition(
      party,
      input.candidatureId,
      committeeId,
      input,
      actor.id,
      origin ? channelMetadata(origin) : {},
    )
    return this.listForCommittee(actor, workspaceId, committeeId)
  }

  // ── Shared ───────────────────────────────────────────────────────────────────────────────────

  // THE change of an entry, for either side, under the candidature's row lock then the committee's.
  private async transition(
    party: CandidatureParty,
    candidatureId: string,
    committeeId: string,
    input: ChangeCommitteeApplicationInput,
    actorId: string,
    origin: Record<string, string>,
  ): Promise<CommitteeApplicationChange> {
    const by: CommitteeApplicationSide = party.side
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.candidatures.lockAs(tx, party, candidatureId)
        if (!locked.submittedAt) throw CommitteeApplicationErrors.notSent()
        const committee = await holdCommittee(tx, committeeId, locked.workspaceId)
        // Read again once the committee is held too (code review R65): holding it may have waited
        // for another transaction, during which the conseiller could be deactivated or the request
        // change hands. The candidature is already locked by this transaction: no wait here, only
        // the right read anew, before anything is written.
        const candidature = await this.candidatures.lockAs(tx, party, candidatureId)
        const entry = await tx.committeeApplication.findFirst({
          where: { committeeId: committee.id, candidatureId: candidature.id },
        })
        const now = Date.now()
        // The owner reaches only the committees they see: one they may apply to, or have an entry on.
        if (by === 'owner' && !entry && !committeeOpenToCandidates(committee, now)) {
          throw CommitteeErrors.notFound()
        }
        const change = await applyChange(tx, { candidature, committee, entry, input, by, now })
        const saved = entry
          ? await tx.committeeApplication.update({
              where: { id: entry.id },
              data: { ...change, statusActorId: actorId, version: entry.version + 1 },
            })
          : await tx.committeeApplication.create({
              data: {
                committeeId: committee.id,
                candidatureId: candidature.id,
                workspaceId: candidature.workspaceId,
                ...change,
                statusActorId: actorId,
                version: 1,
              },
            })
        const from = entry ? committeeApplicationStatusOf(entry.status) : null
        await this.audit.recordIn(tx, {
          actionType: 'committee_application_changed',
          actorId,
          dossierId: candidature.dossierId,
          metadata: {
            workspaceId: candidature.workspaceId,
            committeeId: committee.id,
            candidatureId: candidature.id,
            applicationId: saved.id,
            version: saved.version,
            from,
            to: input.to,
            by,
            ...origin,
          },
        })
        return { application: saved, from, to: input.to, by }
      })
    } catch (err) {
      // Two first changes at once that the candidature's lock did not order: the unique index lets
      // one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw CommitteeApplicationErrors.changed(null, null)
      }
      throw err
    }
  }
}

// The committee of the candidature's workspace, held until the end of the transaction against a
// change of status (`404` alike for an unknown committee and another workspace's).
async function holdCommittee(
  tx: Prisma.TransactionClient,
  committeeId: string,
  workspaceId: string,
): Promise<Committee> {
  await tx.$queryRaw`SELECT 1 FROM "committees" WHERE "id" = ${committeeId} FOR SHARE`
  const committee = await tx.committee.findFirst({ where: { id: committeeId, workspaceId } })
  if (!committee) throw CommitteeErrors.notFound()
  return committee
}

// Checks a change against the version read, the transitions and their conditions; returns the
// columns it writes.
async function applyChange(
  tx: Prisma.TransactionClient,
  args: {
    candidature: Candidature
    committee: Committee
    entry: CommitteeApplication | null
    input: ChangeCommitteeApplicationInput
    by: CommitteeApplicationSide
    now: number
  },
): Promise<{
  status: CommitteeApplicationStatus
  statusBy: CommitteeApplicationSide
  statusChangedAt: Date
}> {
  const { candidature, committee, entry, input, by, now } = args
  const from = entry ? committeeApplicationStatusOf(entry.status) : null
  if ((entry?.version ?? null) !== input.version) {
    throw CommitteeApplicationErrors.changed(from, entry?.version ?? null)
  }
  const verdict = committeeApplicationTransition(from, input.to, by)
  if (verdict === 'impossible') throw CommitteeApplicationErrors.impossible(from, input.to)
  if (verdict === 'forbidden') throw CommitteeApplicationErrors.forbidden(input.to, by)
  const status = committeeStatusOf(committee.status)
  if (status !== 'planned') throw CommitteeApplicationErrors.committeeClosed(status)
  if (ENGAGING_COMMITTEE_APPLICATION_STATUSES.includes(input.to)) {
    if (by === 'owner' && !committeeOpenToCandidates(committee, now)) {
      throw CommitteeApplicationErrors.committeeStarted()
    }
    if (!financingOpenToCommittees(candidature.financingStatus)) {
      throw CommitteeApplicationErrors.financingClosed(
        financingStatusOf(candidature.financingStatus),
      )
    }
    const request = await tx.dossier.findUnique({ where: { id: candidature.dossierId } })
    if (!request || isArchived(request)) throw requestArchived()
  }
  return { status: input.to, statusBy: by, statusChangedAt: new Date(now) }
}

function ownerApplicationView(entry: CommitteeApplication): OwnerCommitteeApplicationView {
  return {
    id: entry.id,
    status: committeeApplicationStatusOf(entry.status),
    by: committeeApplicationSideOf(entry.statusBy),
    changedAt: entry.statusChangedAt,
    version: entry.version,
    createdAt: entry.createdAt,
  }
}

function candidateView(
  committee: Committee,
  entry: CommitteeApplication | null,
): CandidateCommitteeView {
  const application = entry ? ownerApplicationView(entry) : null
  return { committee: candidateCommitteeOf(toView(committee), application), application }
}
