import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { canOwnCompanies, canPrepareCompanies } from '@confluent/shared'
import type { Company, CompanyTransfer, Prisma, User, Workspace } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { DossiersService } from '../dossiers/dossiers.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { CompanyTransferErrors } from './company-transfer-errors'
import {
  currentStatus,
  expiryFrom,
  invitationView,
  type TransferInvitationView,
} from './transfer-view'

// The conseiller acting in a workspace, or the entrepreneur answering: the signed-in account.
export interface TransferActor extends WorkspaceActor {
  email: string
}

interface Person {
  email: string
  firstName: string | null
  lastName: string | null
}

// @confluent/shared `preparedCompanySchema`.
export interface PreparedCompanyView {
  company: { id: string; name: string }
  held: boolean
  heldByMe: boolean
  holder: Person | null
  dossierCount: number | null
  invitation: TransferInvitationView
}

// @confluent/shared `companyTransferOfferSchema`.
export interface CompanyTransferOfferView {
  id: string
  company: { name: string }
  dossierCount: number
  workspace: { name: string; programName: string | null }
  from: Person | null
  invitedAt: Date
  expiresAt: Date
}

type Decision = 'accepted' | 'declined'

const WITH_COMPANY = {
  company: { include: { owner: true, dossiers: { select: { id: true } } } },
} satisfies Prisma.CompanyTransferInclude

type TransferWithCompany = Prisma.CompanyTransferGetPayload<{ include: typeof WITH_COMPANY }>

// Companies a conseiller prepares for an entrepreneur, and the transfer of their ownership
// (ROADMAP E05.08).
//
// A conseiller of a workspace (`canPrepareCompanies`, read at each request through the workspace's
// single access rule) creates a company with its first financing request for an entrepreneur named
// by their address, and holds it — as its owner — while preparing its profile, library and requests
// through the usual screens; the company is marked as prepared in the workspace, which keeps it from
// being shared or published and limits it to that conseiller while they are an active conseiller
// there (`holdsCompany`). The entrepreneur is invited (account created if the address is unknown,
// told by email in any case) and accepts or declines:
//  * accepting makes them the owner of the company in one statement, under the company's lock —
//    every request follows through the dossiers' composite foreign key (ON UPDATE CASCADE), the
//    profile and library belong to the company — and the conseiller loses all access;
//  * declining leaves the company with the conseiller, who may invite another address or delete it.
// Invitations, replacements and decisions on one company are serialized by that same lock, which
// every profile write also takes: a write the conseiller started before the transfer either lands
// before it or is refused (`lockProfile`). Every step is journaled; the transfer row records who
// offered the company to whom, from which workspace and when it was decided.
@Injectable()
export class CompanyTransfersService {
  private readonly logger = new Logger(CompanyTransfersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: WorkspaceAccessService,
    private readonly dossiers: DossiersService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  // ── The workspace's conseillers ──────────────────────────────────────────────────────────────

  // The companies prepared in the workspace, the newest invitation first: those its conseillers
  // still hold, and those taken over by their entrepreneur (no more detail about them).
  async listPrepared(actor: TransferActor, workspaceId: string): Promise<PreparedCompanyView[]> {
    await this.assertCanPrepare(actor, workspaceId)
    const transfers = await this.prisma.companyTransfer.findMany({
      where: { workspaceId },
      include: WITH_COMPANY,
      orderBy: { createdAt: 'desc' },
    })
    const latest = new Map<string, TransferWithCompany>()
    for (const t of transfers) if (!latest.has(t.companyId)) latest.set(t.companyId, t)
    return [...latest.values()].map((t) => preparedView(actor, workspaceId, t))
  }

  async prepare(
    actor: TransferActor,
    workspaceId: string,
    input: { companyName: string; ownerEmail: string },
  ): Promise<{
    preparation: PreparedCompanyView
    dossier: { id: string; slug: string }
    invitationEmailSent: boolean
  }> {
    assertNotSelf(actor, input.ownerEmail)
    const { dossier, offer } = await this.prisma.$transaction(async (tx) => {
      const scope = await this.assertCanPrepare(actor, workspaceId, tx)
      const { company, dossier } = await this.dossiers.createPrepared(tx, {
        holderId: actor.id,
        workspaceId,
        name: input.companyName,
      })
      const offer = await this.offer(tx, actor, company, scope.workspace, input.ownerEmail)
      return { dossier, offer }
    })
    await this.audit.record({
      actionType: 'company_prepared',
      actorId: actor.id,
      dossierId: dossier.id,
      metadata: { companyId: dossier.companyId, workspaceId, companyName: input.companyName },
    })
    await this.recordInvitation(actor, offer, null)
    return {
      preparation: await this.preparedCompany(actor, workspaceId, dossier.companyId),
      dossier: { id: dossier.id, slug: dossier.slug },
      invitationEmailSent: await this.sendInvitation(offer),
    }
  }

  // A new invitation for a company the conseiller holds — to another address, or again after a
  // refusal or an expiry. It replaces the one still waiting for an answer.
  async invite(
    actor: TransferActor,
    workspaceId: string,
    companyId: string,
    input: { email: string },
  ): Promise<{ preparation: PreparedCompanyView; invitationEmailSent: boolean }> {
    assertNotSelf(actor, input.email)
    const { offer, replaced } = await this.prisma.$transaction(async (tx) => {
      const scope = await this.assertCanPrepare(actor, workspaceId, tx)
      const company = await lockHeldCompany(tx, actor, workspaceId, companyId)
      const replaced = await closePending(tx, companyId)
      const offer = await this.offer(tx, actor, company, scope.workspace, input.email)
      return { offer, replaced }
    })
    await this.recordInvitation(actor, offer, replaced)
    return {
      preparation: await this.preparedCompany(actor, workspaceId, companyId),
      invitationEmailSent: await this.sendInvitation(offer),
    }
  }

  // Withdraws the invitation waiting for an answer, if any; the company stays with the conseiller.
  async cancel(
    actor: TransferActor,
    workspaceId: string,
    companyId: string,
  ): Promise<PreparedCompanyView> {
    const withdrawn = await this.prisma.$transaction(async (tx) => {
      await this.assertCanPrepare(actor, workspaceId, tx)
      await lockHeldCompany(tx, actor, workspaceId, companyId)
      return closePending(tx, companyId)
    })
    if (withdrawn) {
      await this.audit.record({
        actionType: 'company_transfer_cancelled',
        actorId: actor.id,
        metadata: transferMetadata(withdrawn),
      })
    }
    return this.preparedCompany(actor, workspaceId, companyId)
  }

  // ── The entrepreneur ──────────────────────────────────────────────────────────────────────────

  // The companies offered to the signed-in account and still waiting for its answer. Only its own:
  // no identifier comes from the client.
  async listOffers(user: { id: string }): Promise<CompanyTransferOfferView[]> {
    const now = new Date()
    const rows = await this.prisma.companyTransfer.findMany({
      where: { toUserId: user.id, status: 'pending', expiresAt: { gt: now } },
      include: { ...WITH_COMPANY, workspace: true, fromUser: true },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((t) => ({
      id: t.id,
      company: { name: t.company.name },
      dossierCount: t.company.dossiers.length,
      workspace: { name: t.workspace.name, programName: t.workspace.programName ?? null },
      from: t.fromUser ? person(t.fromUser) : null,
      invitedAt: t.createdAt,
      expiresAt: t.expiresAt,
    }))
  }

  // Accepting or declining, by the account the invitation is addressed to (404 for any other, as
  // for an unknown one). Answering again the same way changes nothing (the same result); the other
  // way after a decision is a 409; an invitation withdrawn, replaced or expired is a 410. Accepting
  // requires an account that may own companies (`canOwnCompanies`).
  async decide(
    user: TransferActor,
    transferId: string,
    decision: Decision,
  ): Promise<{ status: Decision; companyId: string | null }> {
    const found = await this.prisma.companyTransfer.findUnique({ where: { id: transferId } })
    if (!found || found.toUserId !== user.id) throw CompanyTransferErrors.invitationNotFound()
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockCompany(tx, found.companyId)
      const transfer = await tx.companyTransfer.findUnique({ where: { id: transferId } })
      if (!transfer || transfer.toUserId !== user.id) {
        throw CompanyTransferErrors.invitationNotFound()
      }
      const status = currentStatus(transfer)
      if (status === decision) return { transfer, changed: false, dossierIds: [] as string[] }
      if (status === 'accepted' || status === 'declined') {
        throw CompanyTransferErrors.alreadyDecided(status)
      }
      if (status !== 'pending') throw CompanyTransferErrors.closed()
      let dossierIds: string[] = []
      if (decision === 'accepted') {
        if (!canOwnCompanies(user)) throw CompanyTransferErrors.cannotOwn()
        const company = await tx.company.findUnique({ where: { id: transfer.companyId } })
        // Still prepared, in this workspace, by the conseiller who offered it.
        if (
          !company ||
          company.preparedInWorkspaceId !== transfer.workspaceId ||
          company.ownerId !== transfer.fromUserId
        ) {
          throw CompanyTransferErrors.closed()
        }
        // One statement: the dossiers' (company_id, user_id) foreign key carries the new owner to
        // every request of the company (ON UPDATE CASCADE).
        await tx.company.update({
          where: { id: company.id },
          data: { ownerId: user.id, preparedInWorkspaceId: null },
        })
        dossierIds = (
          await tx.dossier.findMany({ where: { companyId: company.id }, select: { id: true } })
        ).map((d) => d.id)
      }
      const decided = await tx.companyTransfer.update({
        where: { id: transfer.id },
        data: { status: decision, decidedAt: new Date() },
      })
      return { transfer: decided, changed: true, dossierIds }
    })
    if (outcome.changed) {
      await this.audit.record({
        actionType:
          decision === 'accepted' ? 'company_transfer_accepted' : 'company_transfer_declined',
        actorId: user.id,
        metadata: {
          ...transferMetadata(outcome.transfer),
          ...(decision === 'accepted' ? { dossierIds: outcome.dossierIds } : {}),
        },
      })
    }
    return {
      status: decision,
      companyId: decision === 'accepted' ? outcome.transfer.companyId : null,
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────

  // The single workspace access rule (404 outside the workspace), then the finer one: its active
  // conseillers (403 for an investisseur). `tx`: read after the transaction's locks.
  private async assertCanPrepare(
    actor: WorkspaceActor,
    workspaceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const scope = await this.access.resolve(actor, workspaceId, tx)
    if (!canPrepareCompanies(scope.membership)) throw CompanyTransferErrors.conseillersOnly()
    return scope
  }

  // Invites `email` to take the company over: their account is created as an entrepreneur's when
  // the address is unknown (the role an owner of companies needs); an existing account keeps its
  // role. The conseiller learns neither whether the account existed nor anything about it.
  private async offer(
    tx: Prisma.TransactionClient,
    actor: TransferActor,
    company: Company,
    workspace: Workspace,
    rawEmail: string,
  ): Promise<Offer> {
    const email = rawEmail.trim().toLowerCase()
    assertNotSelf(actor, email)
    const created = await tx.user.createMany({
      data: [{ email, role: 'entrepreneur', isActive: true, emailVerifiedAt: null }],
      skipDuplicates: true,
    })
    const invitee = await tx.user.findUnique({ where: { email } })
    if (!invitee) throw new Error(`account ${email} neither created nor found`)
    if (invitee.id === actor.id) throw CompanyTransferErrors.selfInvitation()
    const now = new Date()
    const transfer = await tx.companyTransfer.create({
      data: {
        companyId: company.id,
        workspaceId: workspace.id,
        fromUserId: actor.id,
        toUserId: invitee.id,
        toEmail: email,
        expiresAt: expiryFrom(now),
        createdAt: now,
      },
    })
    const from = await tx.user.findUnique({ where: { id: actor.id } })
    return { transfer, company, workspace, invitee, from, createdAccount: created.count === 1 }
  }

  private async recordInvitation(
    actor: WorkspaceActor,
    offer: Offer,
    replaced: CompanyTransfer | null,
  ): Promise<void> {
    if (replaced) {
      await this.audit.record({
        actionType: 'company_transfer_cancelled',
        actorId: actor.id,
        metadata: { ...transferMetadata(replaced), replacedBy: offer.transfer.id },
      })
    }
    await this.audit.record({
      actionType: 'company_transfer_invited',
      actorId: actor.id,
      metadata: {
        ...transferMetadata(offer.transfer),
        createdAccount: offer.createdAccount,
        expiresAt: offer.transfer.expiresAt.toISOString(),
      },
    })
  }

  // Best effort, like the other invitations: the invitation exists whether or not the email leaves.
  private async sendInvitation(offer: Offer): Promise<boolean> {
    try {
      await this.email.sendCompanyTransferInvite({
        to: offer.invitee.email,
        companyName: offer.company.name,
        workspaceName: offer.workspace.name,
        fromLabel: offer.from ? fromLabel(offer.from) : offer.workspace.name,
        expiresAt: offer.transfer.expiresAt,
        existingAccount: offer.invitee.emailVerifiedAt !== null,
        invitationsUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/dashboard/propositions`,
        locale: 'fr',
      })
      return true
    } catch (err) {
      this.logger.warn(
        `company transfer invitation email not sent (transfer ${offer.transfer.id}): ${(err as Error).message}`,
      )
      return false
    }
  }

  private async preparedCompany(
    actor: TransferActor,
    workspaceId: string,
    companyId: string,
  ): Promise<PreparedCompanyView> {
    const latest = await this.prisma.companyTransfer.findFirst({
      where: { companyId, workspaceId },
      include: WITH_COMPANY,
      orderBy: { createdAt: 'desc' },
    })
    if (!latest) throw CompanyTransferErrors.preparedCompanyNotFound()
    return preparedView(actor, workspaceId, latest)
  }
}

interface Offer {
  transfer: CompanyTransfer
  company: Company
  workspace: Workspace
  invitee: User
  from: User | null
  createdAccount: boolean
}

async function lockCompany(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "id" = ${companyId} FOR UPDATE`
}

// The company, locked, if the actor holds it as prepared in this workspace; else the same 404 for
// an unknown company, one prepared elsewhere, taken over, or held by another conseiller.
async function lockHeldCompany(
  tx: Prisma.TransactionClient,
  actor: WorkspaceActor,
  workspaceId: string,
  companyId: string,
): Promise<Company> {
  await lockCompany(tx, companyId)
  const company = await tx.company.findUnique({ where: { id: companyId } })
  if (!company || company.preparedInWorkspaceId !== workspaceId || company.ownerId !== actor.id) {
    throw CompanyTransferErrors.preparedCompanyNotFound()
  }
  return company
}

// Closes the invitation waiting for an answer, if any (under the company's lock): `expired` past
// its validity, else `cancelled`. Returns it once closed.
async function closePending(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<CompanyTransfer | null> {
  const pending = await tx.companyTransfer.findFirst({ where: { companyId, status: 'pending' } })
  if (!pending) return null
  return tx.companyTransfer.update({
    where: { id: pending.id },
    data: {
      status: currentStatus(pending) === 'expired' ? 'expired' : 'cancelled',
      decidedAt: new Date(),
    },
  })
}

// Nobody offers a company to themselves (their address; their account is checked again in `offer`).
function assertNotSelf(actor: { email: string }, email: string): void {
  if (email.trim().toLowerCase() === actor.email.trim().toLowerCase()) {
    throw CompanyTransferErrors.selfInvitation()
  }
}

function transferMetadata(transfer: CompanyTransfer) {
  return {
    transferId: transfer.id,
    companyId: transfer.companyId,
    workspaceId: transfer.workspaceId,
    fromUserId: transfer.fromUserId,
    toUserId: transfer.toUserId,
    toEmail: transfer.toEmail,
    status: transfer.status,
  }
}

function person(user: User): Person {
  return { email: user.email, firstName: user.firstName, lastName: user.lastName }
}

function fromLabel(user: User): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name ? `${name} (${user.email})` : user.email
}

function preparedView(
  actor: { id: string },
  workspaceId: string,
  transfer: TransferWithCompany,
): PreparedCompanyView {
  const { company } = transfer
  const held = company.preparedInWorkspaceId === workspaceId
  return {
    company: { id: company.id, name: company.name },
    held,
    heldByMe: held && company.ownerId === actor.id,
    holder: held ? person(company.owner) : null,
    dossierCount: held ? company.dossiers.length : null,
    invitation: invitationView(transfer),
  }
}
