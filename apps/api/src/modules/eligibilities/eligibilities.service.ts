import { Injectable } from '@nestjs/common'
import { eligibilitySideOf, type EligibilitySide } from '@confluent/shared'
import {
  Prisma,
  type Candidature,
  type CandidatureEligibility,
  type EligibilityScheme,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import { EligibilityErrors } from './eligibility-errors'
import { SCHEME_ORDER } from './eligibility-schemes.service'

interface SchemeRefView {
  id: string
  key: string
  label: string
  description: string | null
  active: boolean
}

// @confluent/shared `candidatureEligibilitySchema`: which side declared, verified or wrote it last,
// never who.
export interface EligibilityView {
  id: string
  scheme: SchemeRefView
  note: string | null
  declaredBy: EligibilitySide
  declaredAt: Date
  verifiedAt: Date | null
  version: number
  updatedAt: Date
  updatedBy: EligibilitySide
}

// @confluent/shared `candidatureEligibilitiesSchema`.
export interface EligibilitiesView {
  candidatureId: string
  workspaceId: string
  eligibilities: EligibilityView[]
  schemes: SchemeRefView[]
}

export interface DeclareEligibilityInput {
  schemeId: string
  note?: string | null
  // The workspace only.
  verified?: boolean
}

export interface UpdateEligibilityInput {
  version: number
  note?: string | null
  // The workspace only.
  verified?: boolean
}

// A candidature's eligibilities to the schemes of its workspace (ROADMAP E06.05): declarative
// information — Confluent computes no tax benefit and checks no condition —, declared by either
// party of the candidature, with an optional note, and marked verified by the workspace alone once
// it checked it. Kept by its owner (a draft included) and, once sent, by the conseillers of its
// workspace, through the candidatures' access rules (`CandidaturesService.reachAs` / `lockAs`), at
// each request and again under the candidature's row lock. Nobody else reads them: no other
// workspace, no investor, no share recipient, no MCP tool yet (E06.09). An eligibility changed since
// the client read it is refused (409), never overwritten. Each change is journaled
// (`candidature_eligibility_updated`) with its side and author; the view shows the side only.
@Injectable()
export class EligibilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly audit: AuditService,
  ) {}

  async get(party: CandidatureParty, candidatureId: string): Promise<EligibilitiesView> {
    return this.view(await this.candidatures.reachAs(party, candidatureId))
  }

  // An eligibility to an active scheme of the candidature's workspace, at most one per scheme. The
  // workspace may mark it verified at once; the owner never verifies.
  async declare(
    party: CandidatureParty,
    candidatureId: string,
    input: DeclareEligibilityInput,
  ): Promise<EligibilitiesView> {
    const verified = party.side === 'workspace' && input.verified === true
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const scheme = await usableScheme(tx, current.workspaceId, input.schemeId)
      const existing = await tx.candidatureEligibility.findFirst({
        where: { candidatureId: current.id, schemeId: scheme.id },
      })
      if (existing) throw EligibilityErrors.alreadyDeclared(scheme.label)
      const eligibility = await tx.candidatureEligibility.create({
        data: {
          candidatureId: current.id,
          workspaceId: current.workspaceId,
          schemeId: scheme.id,
          note: input.note ?? null,
          declaredBySide: party.side,
          verifiedAt: verified ? new Date() : null,
          verifiedById: verified ? authorId(party) : null,
          ...authorOf(party),
        },
      })
      return { eligibility, scheme }
    }).catch(async (err: unknown) => {
      // Two declarations at once: the unique index lets one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const scheme = await this.prisma.eligibilityScheme.findUnique({
          where: { id: input.schemeId },
        })
        throw EligibilityErrors.alreadyDeclared(scheme?.label ?? '')
      }
      throw err
    })
    await this.record(party, candidature, {
      change: 'declared',
      eligibilityId: result.eligibility.id,
      scheme: result.scheme.key,
      note: result.eligibility.note,
      verified,
    })
    return this.view(candidature)
  }

  // From the version the client saw; nothing changed, nothing written. The owner changes the note —
  // which withdraws a verification: the workspace checked what was declared before. The workspace
  // changes the note and/or verifies or withdraws its verification.
  async update(
    party: CandidatureParty,
    candidatureId: string,
    eligibilityId: string,
    input: UpdateEligibilityInput,
  ): Promise<EligibilitiesView> {
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const eligibility = await eligibilityAt(tx, current.id, eligibilityId, input.version)
      const changes: Array<{ field: string; from: unknown; to: unknown }> = []
      const data: Prisma.CandidatureEligibilityUncheckedUpdateInput = {}
      const wasVerified = eligibility.verifiedAt !== null
      let verified = wasVerified
      if (input.note !== undefined && input.note !== eligibility.note) {
        data.note = input.note
        changes.push({ field: 'note', from: eligibility.note, to: input.note })
        if (party.side === 'owner') verified = false
      }
      if (party.side === 'workspace' && input.verified !== undefined) verified = input.verified
      if (verified !== wasVerified) {
        data.verifiedAt = verified ? new Date() : null
        data.verifiedById = verified ? authorId(party) : null
        changes.push({ field: 'verified', from: wasVerified, to: verified })
      }
      if (changes.length === 0) return { changes, scheme: null }
      await tx.candidatureEligibility.update({
        where: { id: eligibility.id },
        data: { ...data, version: eligibility.version + 1, ...authorOf(party) },
      })
      const scheme = await tx.eligibilityScheme.findUnique({ where: { id: eligibility.schemeId } })
      return { changes, scheme }
    })
    if (result.changes.length > 0) {
      await this.record(party, candidature, {
        change: 'updated',
        eligibilityId,
        scheme: result.scheme?.key ?? null,
        changes: result.changes,
      })
    }
    return this.view(candidature)
  }

  async remove(
    party: CandidatureParty,
    candidatureId: string,
    eligibilityId: string,
    version: number,
  ): Promise<EligibilitiesView> {
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const eligibility = await eligibilityAt(tx, current.id, eligibilityId, version)
      const scheme = await tx.eligibilityScheme.findUnique({ where: { id: eligibility.schemeId } })
      await tx.candidatureEligibility.delete({ where: { id: eligibility.id } })
      return { eligibility, scheme }
    })
    await this.record(party, candidature, {
      change: 'removed',
      eligibilityId,
      scheme: result.scheme?.key ?? null,
      note: result.eligibility.note,
      verified: result.eligibility.verifiedAt !== null,
    })
    return this.view(candidature)
  }

  // Nothing is told to whoever may not reach the candidature; then its row is locked and the access
  // read again after the lock (`CandidaturesService.lockAs`).
  private async write<T>(
    party: CandidatureParty,
    candidatureId: string,
    fn: (tx: Prisma.TransactionClient, candidature: Candidature) => Promise<T>,
  ): Promise<{ candidature: Candidature; result: T }> {
    await this.candidatures.reachAs(party, candidatureId)
    return this.prisma.$transaction(async (tx) => {
      const candidature = await this.candidatures.lockAs(tx, party, candidatureId)
      return { candidature, result: await fn(tx, candidature) }
    })
  }

  private async view(candidature: Candidature): Promise<EligibilitiesView> {
    const [rows, schemes] = await Promise.all([
      this.prisma.candidatureEligibility.findMany({ where: { candidatureId: candidature.id } }),
      this.prisma.eligibilityScheme.findMany({
        where: { workspaceId: candidature.workspaceId },
        orderBy: SCHEME_ORDER,
      }),
    ])
    const declared = new Map(rows.map((row) => [row.schemeId, row]))
    return {
      candidatureId: candidature.id,
      workspaceId: candidature.workspaceId,
      eligibilities: schemes
        .filter((scheme) => declared.has(scheme.id))
        .map((scheme) => eligibilityView(declared.get(scheme.id)!, scheme)),
      schemes: schemes.filter((s) => s.active && !declared.has(s.id)).map(schemeRef),
    }
  }

  private record(
    party: CandidatureParty,
    candidature: Candidature,
    details: Record<string, unknown>,
  ) {
    return this.audit.record({
      actionType: 'candidature_eligibility_updated',
      actorId: authorId(party),
      dossierId: candidature.dossierId,
      metadata: {
        candidatureId: candidature.id,
        workspaceId: candidature.workspaceId,
        side: party.side,
        ...details,
      },
    })
  }
}

const authorId = (party: CandidatureParty) =>
  party.side === 'owner' ? party.userId : party.actor.id

function authorOf(party: CandidatureParty) {
  return { updatedBySide: party.side, updatedById: authorId(party) }
}

// A scheme a new declaration may take: one of the workspace's (`400` alike for an unknown one and
// another workspace's — the composite foreign key refuses it anyway), still offered (`409` once
// deactivated).
async function usableScheme(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  schemeId: string,
): Promise<EligibilityScheme> {
  const scheme = await tx.eligibilityScheme.findFirst({ where: { id: schemeId, workspaceId } })
  if (!scheme) throw EligibilityErrors.schemeUnknown()
  if (!scheme.active) throw EligibilityErrors.schemeInactive(scheme.label)
  return scheme
}

// The eligibility of this candidature, at the version the client saw.
async function eligibilityAt(
  tx: Prisma.TransactionClient,
  candidatureId: string,
  eligibilityId: string,
  version: number,
): Promise<CandidatureEligibility> {
  const row = await tx.candidatureEligibility.findFirst({
    where: { id: eligibilityId, candidatureId },
  })
  if (!row) throw EligibilityErrors.notFound()
  if (row.version !== version) throw EligibilityErrors.changed(row.version)
  return row
}

function schemeRef(row: EligibilityScheme): SchemeRefView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    active: row.active,
  }
}

function eligibilityView(row: CandidatureEligibility, scheme: EligibilityScheme): EligibilityView {
  return {
    id: row.id,
    scheme: schemeRef(scheme),
    note: row.note,
    declaredBy: eligibilitySideOf(row.declaredBySide),
    declaredAt: row.createdAt,
    verifiedAt: row.verifiedAt,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: eligibilitySideOf(row.updatedBySide),
  }
}
