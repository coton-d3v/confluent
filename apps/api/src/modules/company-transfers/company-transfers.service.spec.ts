import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../config/config.schema'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import type { EmailTransport } from '../auth/email/email-transport'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import { holdsCompany } from '../companies/company-access'
import { DossiersService } from '../dossiers/dossiers.service'
import type { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { CompanyTransfersService } from './company-transfers.service'
import { quietNotifications } from '../../testing/notifications'

// Marie: conseillère of the CCI (a financeur account, as an invitation leaves it); Jean: another
// conseiller of the CCI; Paul: conseiller of the club deal; Claire: investisseur of the CCI.
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const FIN = { id: 'u-fin', email: 'fin@banque.fr', role: 'financeur' as const }
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  for (const u of [MARIE, JEAN, PAUL, CLAIRE, SOPHIE, FIN, ADMIN]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  await p.user.update({ where: { id: MARIE.id }, data: { firstName: 'Marie', lastName: 'Dupont' } })
  await p.workspace.create({ data: { id: CCI, slug: 'cci', name: 'CCI Touraine' } })
  await p.workspace.create({ data: { id: CLUB, slug: 'club', name: 'Club deal' } })
  const member = (workspaceId: string, userId: string, role: string) =>
    p.workspaceMembership.create({ data: { workspaceId, userId, role } })
  const marieInCci = await member(CCI, MARIE.id, 'conseiller')
  await member(CCI, JEAN.id, 'conseiller')
  await member(CLUB, PAUL.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const companies = new CompaniesService(p as never)
  const dossiers = new DossiersService(
    p as never,
    {
      ensureBootstrap: jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
      getVersion: jest.fn().mockResolvedValue(null),
    } as unknown as QuestionnairesService,
    {} as ClassificationService,
    audit as unknown as AuditService,
    companies,
  )
  const email = {
    sendCompanyTransferInvite: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailTransport & { sendCompanyTransferInvite: jest.Mock }
  const config = { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>
  const transfers = new CompanyTransfersService(
    p as never,
    audit as unknown as AuditService,
    new WorkspaceAccessService(p as never),
    dossiers,
    config,
    email,
    quietNotifications(p as never),
  )
  const prepared = (name = 'Biosensio', ownerEmail = SOPHIE.email) =>
    transfers.prepare(MARIE, CCI, { companyName: name, ownerEmail })
  const pendingOf = (companyId: string) =>
    [...fake.table('companyTransfer').values()].find(
      (t) => t.companyId === companyId && t.status === 'pending',
    )!
  const actions = () =>
    audit.record.mock.calls.map(([e]) => (e as { actionType: string }).actionType)
  return {
    fake,
    p,
    audit,
    companies,
    dossiers,
    transfers,
    email,
    prepared,
    pendingOf,
    actions,
    marieInCci,
  }
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(HttpException)
  const body = (err as HttpException).getResponse() as { code?: string }
  return { status: (err as HttpException).getStatus(), code: body.code }
}

// ROADMAP E05.08: a conseiller prepares a company for an entrepreneur, who accepts or declines it.
describe('companies prepared for an entrepreneur', () => {
  describe('preparing and inviting', () => {
    it('creates the company and its first request held by the conseiller, opens an entrepreneur account for an unknown address and invites it', async () => {
      const { fake, transfers, email, actions } = await setup()
      const res = await transfers.prepare(MARIE, CCI, {
        companyName: 'Hydrolia',
        ownerEmail: 'lea@hydrolia.fr',
      })
      const company = fake.table('company').get(res.preparation.company.id)!
      expect(company).toMatchObject({
        ownerId: MARIE.id,
        name: 'Hydrolia',
        preparedInWorkspaceId: CCI,
      })
      const dossier = fake.table('dossier').get(res.dossier.id)!
      expect(dossier).toMatchObject({ userId: MARIE.id, companyId: company.id, name: 'Hydrolia' })
      const lea = [...fake.table('user').values()].find((u) => u.email === 'lea@hydrolia.fr')!
      // The role an owner of companies needs; never signed in.
      expect(lea).toMatchObject({ role: 'entrepreneur', emailVerifiedAt: null })
      const [transfer] = [...fake.table('companyTransfer').values()]
      expect(transfer).toMatchObject({
        companyId: company.id,
        workspaceId: CCI,
        fromUserId: MARIE.id,
        toUserId: lea.id,
        toEmail: 'lea@hydrolia.fr',
        status: 'pending',
        decidedAt: null,
      })
      const days = ((transfer.expiresAt as Date).getTime() - Date.now()) / 86_400_000
      expect(Math.round(days)).toBe(30)
      expect(res).toEqual({
        preparation: {
          company: { id: company.id, name: 'Hydrolia' },
          held: true,
          heldByMe: true,
          holder: { email: MARIE.email, firstName: 'Marie', lastName: 'Dupont' },
          dossierCount: 1,
          invitation: expect.objectContaining({ email: 'lea@hydrolia.fr', status: 'pending' }),
        },
        dossier: { id: dossier.id, slug: 'hydrolia' },
        invitationEmailSent: true,
      })
      expect(email.sendCompanyTransferInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lea@hydrolia.fr',
          companyName: 'Hydrolia',
          workspaceName: 'CCI Touraine',
          fromLabel: 'Marie Dupont (marie@cci.fr)',
          existingAccount: false,
          invitationsUrl: 'http://localhost:5173/dashboard/propositions',
        }),
      )
      expect(actions()).toEqual(['company_prepared', 'company_transfer_invited'])
    })

    it('tells an existing account by email, keeps its role, and tells the conseiller nothing about it', async () => {
      const { fake, transfers, email } = await setup()
      const known = await transfers.prepare(MARIE, CCI, {
        companyName: 'Biosensio',
        ownerEmail: ' Sophie@Biosensio.fr ',
      })
      const unknown = await transfers.prepare(MARIE, CCI, {
        companyName: 'Agrotech',
        ownerEmail: 'new@agrotech.fr',
      })
      expect(fake.table('user').get(SOPHIE.id)).toMatchObject({ role: 'entrepreneur' })
      expect(email.sendCompanyTransferInvite.mock.calls[0][0]).toMatchObject({
        to: SOPHIE.email,
        existingAccount: true,
      })
      // Same keys, same kind of values: nothing tells the two apart.
      const shape = (r: typeof known) => ({
        ...r,
        preparation: { ...r.preparation, company: null, invitation: null },
        dossier: null,
      })
      expect(shape(known)).toEqual(shape(unknown))
      expect(Object.keys(known.preparation.invitation).sort()).toEqual(
        ['decidedAt', 'email', 'expiresAt', 'id', 'invitedAt', 'status'].sort(),
      )
    })

    it('keeps the email best effort: the invitation exists when it cannot be sent', async () => {
      const { transfers, email, fake } = await setup()
      email.sendCompanyTransferInvite.mockRejectedValueOnce(new Error('535 auth'))
      const res = await transfers.prepare(MARIE, CCI, {
        companyName: 'Biosensio',
        ownerEmail: SOPHIE.email,
      })
      expect(res.invitationEmailSent).toBe(false)
      expect(fake.table('companyTransfer').size).toBe(1)
    })

    it('lets only the workspace’s active conseillers prepare: 403 inside, 404 outside, as for an unknown workspace', async () => {
      const { transfers, fake } = await setup()
      const input = { companyName: 'X', ownerEmail: 'x@x.fr' }
      expect(await failure(transfers.prepare(CLAIRE, CCI, input))).toEqual({
        status: 403,
        code: 'COMPANY_PREPARATION_FORBIDDEN',
      })
      // A Confluent administrator enters every workspace but is no conseiller of it.
      expect((await failure(transfers.prepare(ADMIN, CCI, input))).status).toBe(403)
      for (const outsider of [PAUL, SOPHIE, FIN]) {
        expect((await failure(transfers.prepare(outsider, CCI, input))).status).toBe(404)
        expect((await failure(transfers.listPrepared(outsider, CCI))).status).toBe(404)
      }
      expect((await failure(transfers.prepare(MARIE, 'ws-unknown', input))).status).toBe(404)
      expect((await failure(transfers.listPrepared(CLAIRE, CCI))).status).toBe(403)
      expect(fake.table('company').size).toBe(0)
      expect(fake.table('companyTransfer').size).toBe(0)
    })

    it('refuses a deactivated conseiller and a self-invitation', async () => {
      const { transfers, p, marieInCci, fake } = await setup()
      expect(
        await failure(
          transfers.prepare(MARIE, CCI, { companyName: 'X', ownerEmail: 'MARIE@cci.fr' }),
        ),
      ).toEqual({ status: 400, code: 'VALIDATION_ERROR' })
      await p.workspaceMembership.update({
        where: { id: marieInCci.id },
        data: { deactivatedAt: new Date() },
      })
      expect(
        (await failure(transfers.prepare(MARIE, CCI, { companyName: 'X', ownerEmail: 'x@x.fr' })))
          .status,
      ).toBe(404)
      expect(fake.table('company').size).toBe(0)
    })
  })

  describe('while the conseiller holds the company', () => {
    it('lets only its holder work on it, with the usual operations, and never share nor publish it', async () => {
      const { transfers, dossiers, companies, prepared } = await setup()
      const { dossier, preparation } = await prepared()
      const companyId = preparation.company.id
      // The holder: a financeur account, reading as the owner.
      expect(await dossiers.getByIdForUser(dossier.id, MARIE.id)).toMatchObject({ id: dossier.id })
      expect(await dossiers.resolveReadAccess(dossier.id, MARIE)).toMatchObject({
        accessLevel: 'complet',
        relation: 'owner',
      })
      const listed = await dossiers.listForUser(MARIE)
      expect(listed.map((d) => d.id)).toEqual([dossier.id])
      expect(listed[0]).toMatchObject({ company: { id: companyId, inPreparation: true } })
      const another = await dossiers.createForCompany({ owner: MARIE, companyId, name: 'Série A' })
      expect(another).toMatchObject({ userId: MARIE.id, companyId })
      expect(await companies.getForOwner(companyId, MARIE)).toMatchObject({
        preparation: {
          workspace: { id: CCI, name: 'CCI Touraine' },
          invitation: { email: SOPHIE.email, status: 'pending' },
        },
      })
      // Diffusing is the entrepreneur's decision.
      expect(await failure(dossiers.getForDiffusion(dossier.id, MARIE.id))).toEqual({
        status: 409,
        code: 'COMPANY_IN_PREPARATION',
      })
      expect((await failure(dossiers.publish(dossier.id, MARIE.id))).status).toBe(409)
      // Nobody else: another conseiller of the workspace, the future owner, an administrator.
      for (const other of [JEAN, SOPHIE, ADMIN]) {
        expect((await failure(dossiers.getByIdForUser(dossier.id, other.id))).status).toBe(404)
        expect((await failure(dossiers.resolveReadAccess(dossier.id, other))).status).toBe(404)
        expect((await failure(companies.getForOwner(companyId, other))).status).toBe(404)
        expect(await dossiers.listForUser(other)).toEqual([])
      }
      // The workspace's conseillers see it in the workspace; its holder only may act on it.
      const [seenByJean] = await transfers.listPrepared(JEAN, CCI)
      expect(seenByJean).toMatchObject({ held: true, heldByMe: false, dossierCount: 2 })
      expect(
        (await failure(transfers.invite(JEAN, CCI, companyId, { email: 'x@x.fr' }))).status,
      ).toBe(404)
      expect((await failure(transfers.cancel(JEAN, CCI, companyId))).status).toBe(404)
      expect(
        (await failure(transfers.invite(MARIE, CLUB, companyId, { email: 'x@x.fr' }))).status,
      ).toBe(404)
    })

    it('stops the holder’s access as soon as they are no longer an active conseiller of the workspace', async () => {
      const { dossiers, companies, prepared, p, marieInCci } = await setup()
      const { dossier, preparation } = await prepared()
      await p.workspaceMembership.update({
        where: { id: marieInCci.id },
        data: { deactivatedAt: new Date() },
      })
      expect((await failure(dossiers.getByIdForUser(dossier.id, MARIE.id))).status).toBe(404)
      expect((await failure(dossiers.resolveReadAccess(dossier.id, MARIE))).status).toBe(404)
      expect((await failure(companies.findOwned(preparation.company.id, MARIE))).status).toBe(404)
      expect(await dossiers.listForUser(MARIE)).toEqual([])
      expect(await companies.listForOwner(MARIE)).toEqual([])
      // Back as an investisseur: still nothing.
      await p.workspaceMembership.update({
        where: { id: marieInCci.id },
        data: { deactivatedAt: null, role: 'investisseur' },
      })
      expect((await failure(dossiers.getByIdForUser(dossier.id, MARIE.id))).status).toBe(404)
    })
  })

  describe('the entrepreneur’s answer', () => {
    it('transfers the company with all its requests on acceptance, once; the conseiller loses all access', async () => {
      const { fake, transfers, dossiers, companies, prepared, pendingOf, actions } = await setup()
      const own = await dossiers.create({ owner: SOPHIE, name: 'Sa propre entreprise' })
      const { dossier, preparation } = await prepared()
      const companyId = preparation.company.id
      const second = await dossiers.createForCompany({ owner: MARIE, companyId, name: 'Série A' })
      const transfer = pendingOf(companyId)
      const [offer] = await transfers.listOffers(SOPHIE)
      expect(offer).toEqual({
        id: transfer.id,
        company: { name: 'Biosensio' },
        dossierCount: 2,
        workspace: { name: 'CCI Touraine', programName: null },
        from: { email: MARIE.email, firstName: 'Marie', lastName: 'Dupont' },
        invitedAt: transfer.createdAt,
        expiresAt: transfer.expiresAt,
      })

      expect(await transfers.decide(SOPHIE, transfer.id, 'accepted')).toEqual({
        status: 'accepted',
        companyId,
      })
      expect(fake.table('company').get(companyId)).toMatchObject({
        ownerId: SOPHIE.id,
        preparedInWorkspaceId: null,
      })
      for (const id of [dossier.id, second.id]) {
        expect(fake.table('dossier').get(id)).toMatchObject({ userId: SOPHIE.id })
        expect(await dossiers.getByIdForUser(id, SOPHIE.id)).toMatchObject({ id })
        expect((await failure(dossiers.getByIdForUser(id, MARIE.id))).status).toBe(404)
      }
      expect(await dossiers.getForDiffusion(dossier.id, SOPHIE.id)).toMatchObject({
        id: dossier.id,
      })
      // Her own company is untouched; she now has both.
      expect(fake.table('company').get(own.companyId)).toMatchObject({ ownerId: SOPHIE.id })
      expect((await companies.listForOwner(SOPHIE)).map((c) => c.id).sort()).toEqual(
        [companyId, own.companyId].sort(),
      )
      expect(await dossiers.listForUser(MARIE)).toEqual([])
      expect(fake.table('companyTransfer').get(transfer.id)).toMatchObject({
        status: 'accepted',
        decidedAt: expect.any(Date),
      })

      // Accepting again changes nothing; declining afterwards is refused.
      expect(await transfers.decide(SOPHIE, transfer.id, 'accepted')).toEqual({
        status: 'accepted',
        companyId,
      })
      expect(await failure(transfers.decide(SOPHIE, transfer.id, 'declined'))).toEqual({
        status: 409,
        code: 'COMPANY_TRANSFER_DECIDED',
      })
      expect(actions().filter((a) => a === 'company_transfer_accepted')).toHaveLength(1)
      expect(await transfers.listOffers(SOPHIE)).toEqual([])
      // The workspace keeps the trace, nothing more about the company.
      const [listed] = await transfers.listPrepared(MARIE, CCI)
      expect(listed).toMatchObject({
        held: false,
        heldByMe: false,
        holder: null,
        dossierCount: null,
        invitation: { status: 'accepted', email: SOPHIE.email },
      })
      expect(
        (await failure(transfers.invite(MARIE, CCI, companyId, { email: 'x@x.fr' }))).status,
      ).toBe(404)
    })

    it('journals who gave the company to whom, from which workspace, with its requests', async () => {
      const { transfers, prepared, pendingOf, audit } = await setup()
      const { dossier, preparation } = await prepared()
      const transfer = pendingOf(preparation.company.id)
      await transfers.decide(SOPHIE, transfer.id, 'accepted')
      expect(audit.record).toHaveBeenLastCalledWith({
        actionType: 'company_transfer_accepted',
        actorId: SOPHIE.id,
        metadata: {
          transferId: transfer.id,
          companyId: preparation.company.id,
          workspaceId: CCI,
          fromUserId: MARIE.id,
          toUserId: SOPHIE.id,
          toEmail: SOPHIE.email,
          status: 'accepted',
          dossierIds: [dossier.id],
        },
      })
    })

    it('leaves a declined company with its conseiller, who may invite another address', async () => {
      const { fake, transfers, dossiers, prepared, pendingOf } = await setup()
      const { dossier, preparation } = await prepared()
      const companyId = preparation.company.id
      const first = pendingOf(companyId)
      expect(await transfers.decide(SOPHIE, first.id, 'declined')).toEqual({
        status: 'declined',
        companyId: null,
      })
      expect(await transfers.decide(SOPHIE, first.id, 'declined')).toEqual({
        status: 'declined',
        companyId: null,
      })
      expect(await failure(transfers.decide(SOPHIE, first.id, 'accepted'))).toEqual({
        status: 409,
        code: 'COMPANY_TRANSFER_DECIDED',
      })
      expect(fake.table('company').get(companyId)).toMatchObject({
        ownerId: MARIE.id,
        preparedInWorkspaceId: CCI,
      })
      expect(await dossiers.getByIdForUser(dossier.id, MARIE.id)).toMatchObject({ id: dossier.id })
      expect((await failure(dossiers.getByIdForUser(dossier.id, SOPHIE.id))).status).toBe(404)
      const { preparation: again } = await transfers.invite(MARIE, CCI, companyId, {
        email: 'associe@biosensio.fr',
      })
      expect(again.invitation).toMatchObject({ email: 'associe@biosensio.fr', status: 'pending' })
    })

    it('refuses a financeur account the ownership, leaving the invitation open', async () => {
      const { transfers, prepared, pendingOf, fake } = await setup()
      const { preparation } = await prepared('Biosensio', FIN.email)
      const transfer = pendingOf(preparation.company.id)
      expect(await failure(transfers.decide(FIN, transfer.id, 'accepted'))).toEqual({
        status: 403,
        code: 'COMPANY_OWNERS_ONLY',
      })
      expect(fake.table('companyTransfer').get(transfer.id)).toMatchObject({ status: 'pending' })
      expect(fake.table('company').get(preparation.company.id)).toMatchObject({ ownerId: MARIE.id })
      expect(await transfers.decide(FIN, transfer.id, 'declined')).toMatchObject({
        status: 'declined',
      })
    })

    it('answers only the invited account, and no withdrawn, replaced or expired invitation', async () => {
      const { fake, transfers, prepared, pendingOf } = await setup()
      const { preparation } = await prepared()
      const companyId = preparation.company.id
      const first = pendingOf(companyId)
      for (const other of [MARIE, JEAN, FIN, ADMIN]) {
        expect(await failure(transfers.decide(other, first.id, 'accepted'))).toEqual({
          status: 404,
          code: 'COMPANY_TRANSFER_NOT_FOUND',
        })
      }
      expect((await failure(transfers.decide(SOPHIE, 'unknown', 'accepted'))).status).toBe(404)

      // Replaced by a new invitation.
      await transfers.invite(MARIE, CCI, companyId, { email: SOPHIE.email })
      expect(fake.table('companyTransfer').get(first.id)).toMatchObject({
        status: 'cancelled',
        decidedAt: expect.any(Date),
      })
      expect(await failure(transfers.decide(SOPHIE, first.id, 'accepted'))).toEqual({
        status: 410,
        code: 'COMPANY_TRANSFER_CLOSED',
      })
      // Withdrawn.
      const second = pendingOf(companyId)
      const withdrawn = await transfers.cancel(MARIE, CCI, companyId)
      expect(withdrawn.invitation).toMatchObject({ id: second.id, status: 'cancelled' })
      expect((await failure(transfers.decide(SOPHIE, second.id, 'declined'))).status).toBe(410)
      expect(await transfers.listOffers(SOPHIE)).toEqual([])
      // Withdrawing again changes nothing.
      expect((await transfers.cancel(MARIE, CCI, companyId)).invitation.id).toBe(second.id)

      // Expired: not offered any more, cannot be answered, closed as expired when replaced.
      await transfers.invite(MARIE, CCI, companyId, { email: SOPHIE.email })
      const third = pendingOf(companyId)
      third.expiresAt = new Date(Date.now() - 1000)
      expect(await transfers.listOffers(SOPHIE)).toEqual([])
      expect((await failure(transfers.decide(SOPHIE, third.id, 'accepted'))).status).toBe(410)
      const [listed] = await transfers.listPrepared(MARIE, CCI)
      expect(listed.invitation).toMatchObject({ id: third.id, status: 'expired' })
      await transfers.invite(MARIE, CCI, companyId, { email: SOPHIE.email })
      expect(fake.table('companyTransfer').get(third.id)).toMatchObject({ status: 'expired' })
      expect(fake.table('company').get(companyId)).toMatchObject({ ownerId: MARIE.id })
    })
  })

  describe('the holding rule', () => {
    const company = (preparedInWorkspaceId: string | null) => ({
      ownerId: MARIE.id,
      preparedInWorkspaceId,
    })
    const membership = (role: string, deactivatedAt: Date | null = null) => ({
      role,
      deactivatedAt,
    })

    it('is the owner for a company of their own, whatever their memberships', () => {
      expect(holdsCompany(MARIE, company(null), null)).toBe(true)
      expect(holdsCompany(SOPHIE, company(null), null)).toBe(false)
    })

    it('is, for a prepared company, its owner while an active conseiller of its workspace — closed by default', () => {
      expect(holdsCompany(MARIE, company(CCI), membership('conseiller'))).toBe(true)
      expect(holdsCompany(MARIE, company(CCI), null)).toBe(false)
      expect(holdsCompany(MARIE, company(CCI), membership('conseiller', new Date()))).toBe(false)
      expect(holdsCompany(MARIE, company(CCI), membership('investisseur'))).toBe(false)
      expect(holdsCompany(MARIE, company(CCI), membership('admin'))).toBe(false)
      expect(holdsCompany(JEAN, company(CCI), membership('conseiller'))).toBe(false)
    })
  })
})
