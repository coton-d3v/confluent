import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { AccountDeletionService } from '../../src/modules/privacy/account-deletion.service'
import { RetentionService } from '../../src/modules/privacy/retention.service'
import { StorageCleanupService } from '../../src/modules/privacy/storage-cleanup.service'
import { quietNotifications } from '../../src/testing/notifications'
import { testDatabase } from './database'
import { privacyDown, privacyUp } from './sql-file'

const DAY = 24 * 60 * 60 * 1000

const outcome = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as unknown
  return err instanceof HttpException
    ? `${err.getStatus()} ${(err.getResponse() as { code?: string }).code}`
    : String(err)
}

// ROADMAP E10.10 on PostgreSQL: the deletion of an account is one transaction that removes what the
// account alone holds (cascades), keeps others' records without naming it (SET NULL, pseudonymized
// journal, shares addressed to it revoked) and queues its files for the storage (trigger); two
// administrators, or a decision and a withdrawal, never both apply; a share being created while the
// deletion waits for the request's lock is seen after the wait and blocks it. The retention job
// deletes what is expired and nothing else, under its advisory lock, and does nothing more when run
// again or twice at once; the storage cleanup deletes a file only once no document refers to it.
describe('personal data: deletion and retention (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const storage = new MemoryStorageAdapter()
  const cleanup = new StorageCleanupService(prisma, storage)
  const sent: string[] = []
  const deletions = new AccountDeletionService(
    prisma,
    audit,
    quietNotifications(prisma),
    cleanup,
    { get: () => 'https://confluent.example' } as unknown as ConfigService<AppConfig, true>,
    {
      sendAccountDeleted: (input: { to: string }) => {
        sent.push(input.to)
        return Promise.resolve()
      },
    } as unknown as EmailTransport,
  )
  const retention = new RetentionService(prisma, cleanup)
  const tag = randomUUID().slice(0, 8)
  let formId = ''
  let versionId = ''
  const workspaces: string[] = []

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `privacy-${tag}`, name: 'Profil' },
    })
    formId = form.id
    versionId = (
      await prisma.questionnaireVersion.create({
        data: { questionnaireId: form.id, version: 1, status: 'published' },
      })
    ).id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev`, mode: 'insensitive' } },
    })
    const ids = users.map((u) => u.id)
    await prisma.accountDeletionRequest.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectRef: { startsWith: 'compte-supprime-' } }] },
    })
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    for (const id of workspaces) {
      await prisma.candidature.deleteMany({ where: { workspaceId: id } })
      await prisma.questionnaireVersion.deleteMany({
        where: { questionnaire: { workspaceId: id } },
      })
      await prisma.questionnaire.deleteMany({ where: { workspaceId: id } })
    }
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.storageDeletion.deleteMany({ where: { storageKey: { contains: tag } } })
    await prisma.$disconnect()
  })

  const user = (name: string, role: 'entrepreneur' | 'financeur' | 'admin' = 'entrepreneur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
        firstName: name,
        lastName: 'Test',
      },
    })

  async function requestOf(owner: { id: string }, name = 'Biosensio') {
    const company = await prisma.company.create({
      data: { ownerId: owner.id, name, profileVersionId: versionId },
    })
    const dossier = await prisma.dossier.create({
      data: {
        userId: owner.id,
        companyId: company.id,
        name,
        slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        questionnaireVersionId: versionId,
      },
    })
    return { company, dossier }
  }

  async function workspaceWithForm() {
    const workspace = await prisma.workspace.create({
      data: { name: 'Structure test', slug: `pg-${randomUUID().slice(0, 12)}` },
    })
    workspaces.push(workspace.id)
    const form = await prisma.questionnaire.create({
      data: {
        slug: `form-${randomUUID().slice(0, 8)}`,
        name: 'Formulaire',
        usage: 'candidature',
        workspaceId: workspace.id,
      },
    })
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    return { workspace, formVersionId: version.id }
  }

  const pendingFor = async (u: { id: string; email: string; role: string }) =>
    (await deletions.request(u)).id

  it('deletes what the account alone holds and keeps the others’ records without naming it', async () => {
    const admin = await user('admin', 'admin')
    const alice = await user('alice')
    const bob = await user('bob', 'financeur')
    const conseiller = await user('conseiller', 'financeur')
    const { company, dossier } = await requestOf(alice)
    const key = `documents/${tag}/${randomUUID()}`
    const library = await prisma.libraryDocument.create({
      data: { companyId: company.id, filename: 'bp.pdf' },
    })
    await prisma.document.create({
      data: {
        libraryDocumentId: library.id,
        companyId: company.id,
        filename: 'bp.pdf',
        mimetype: 'application/pdf',
        storageKey: key,
        size: 10,
      },
    })
    await storage.upload(key, Buffer.from('pdf'), 'application/pdf')
    // A share Alice gave, already revoked (not a blocker); a closed candidature with a structure's note.
    await prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail: bob.email,
        token: randomUUID(),
        status: 'revoked',
        revokedAt: new Date(),
      },
    })
    const { workspace, formVersionId } = await workspaceWithForm()
    const candidature = await prisma.candidature.create({
      data: {
        dossierId: dossier.id,
        workspaceId: workspace.id,
        formVersionId,
        createdAt: new Date(Date.now() - DAY),
        submittedAt: new Date(),
        financingStatus: 'funded',
      },
    })
    // Bob's request, shared with Alice, read by her; the journal citing her.
    const bobs = await requestOf(bob, 'Robotix')
    const shareToAlice = await prisma.shareLink.create({
      data: {
        dossierId: bobs.dossier.id,
        recipientEmail: alice.email.toUpperCase(),
        token: randomUUID(),
        status: 'active',
      },
    })
    const reading = await prisma.readingSession.create({
      data: {
        dossierId: bobs.dossier.id,
        readerId: alice.id,
        channel: 'share',
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
    const ownEntry = await prisma.auditLog.create({
      data: {
        actionType: 'share_link_viewed',
        actorId: alice.id,
        metadata: { ip: '203.0.113.7', userAgent: 'Firefox', instruction: 'Remplis', tool: 'x' },
      },
    })
    const citing = await prisma.auditLog.create({
      data: {
        actionType: 'share_link_created',
        actorId: bob.id,
        dossierId: bobs.dossier.id,
        metadata: {
          recipientEmail: alice.email,
          note: `écrit à ${alice.email}`,
          other: `x.${alice.email}`,
          ip: '198.51.100.1',
        },
      },
    })
    await prisma.participationRequest.create({
      data: {
        workspaceId: workspace.id,
        email: alice.email,
        name: 'Alice',
        lastSubmittedAt: new Date(),
      },
    })
    await prisma.refreshSession.create({
      data: { userId: alice.id, familyId: randomUUID(), expiresAt: new Date(Date.now() + DAY) },
    })
    // Her membership, her mark of interest, a note she wrote as a conseiller, an AI connection.
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: alice.id, role: 'conseiller' },
    })
    await prisma.investorInterest.create({
      data: { dossierId: bobs.dossier.id, investorId: alice.id },
    })
    const bobsCandidature = await prisma.candidature.create({
      data: { dossierId: bobs.dossier.id, workspaceId: workspace.id, formVersionId },
    })
    const note = await prisma.candidatureNote.create({
      data: {
        candidatureId: bobsCandidature.id,
        workspaceId: workspace.id,
        authorId: alice.id,
        body: 'Note de la structure',
      },
    })
    const client = await prisma.oAuthClient.create({
      data: {
        id: `c-${tag}-${randomUUID()}`,
        source: 'dcr',
        name: 'Claude',
        redirectUris: [],
        metadata: {},
      },
    })
    const grant = await prisma.oAuthGrant.create({
      data: {
        userId: alice.id,
        clientId: client.id,
        scopes: ['dossiers:read'],
        resource: 'r',
        expiresAt: new Date(Date.now() + DAY),
      },
    })
    await prisma.oAuthToken.create({
      data: {
        grantId: grant.id,
        kind: 'access',
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + DAY),
      },
    })

    const requestId = await pendingFor(alice)
    const decided = await deletions.complete(admin, requestId)

    expect(decided).toMatchObject({ status: 'completed', account: null, confirmationEmail: 'sent' })
    expect(decided.summary).toMatchObject({
      companies: 1,
      requests: 1,
      documents: 1,
      closedCandidatures: 1,
      sharesReceived: 1,
      publicFormRequests: 1,
      journalEntriesPseudonymized: 1,
    })
    expect(sent).toContain(alice.email)
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull()
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(0)
    expect(await prisma.candidature.count({ where: { id: candidature.id } })).toBe(0)
    expect(await prisma.refreshSession.count({ where: { userId: alice.id } })).toBe(0)
    // Others' records kept, no longer pointing to her.
    expect(await prisma.readingSession.findUnique({ where: { id: reading.id } })).toMatchObject({
      readerId: null,
    })
    const share = await prisma.shareLink.findUniqueOrThrow({ where: { id: shareToAlice.id } })
    expect(share.status).toBe('revoked')
    expect(share.recipientEmail).toBe(`${decided.subjectRef}@confluent.invalid`)
    const own = await prisma.auditLog.findUniqueOrThrow({ where: { id: ownEntry.id } })
    expect(own.actorId).toBeNull()
    expect(own.metadata).toEqual({ tool: 'x' })
    // Whole values only (R64): the address cited in a text, or inside another one, stays.
    const cited = await prisma.auditLog.findUniqueOrThrow({ where: { id: citing.id } })
    expect(cited.metadata).toEqual({
      recipientEmail: decided.subjectRef,
      note: `écrit à ${alice.email}`,
      other: `x.${alice.email}`,
      ip: '198.51.100.1',
    })
    expect(await prisma.participationRequest.count({ where: { email: alice.email } })).toBe(0)
    const deleted = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'account_deleted', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(JSON.stringify(deleted.metadata)).not.toContain(alice.email)
    // Its file: queued by the trigger in the transaction, then removed from the storage.
    await cleanup.drain()
    expect(await storage.exists(key)).toBe(false)
    expect(await prisma.storageDeletion.count({ where: { storageKey: key } })).toBe(0)
    expect(await prisma.oAuthGrant.count({ where: { id: grant.id } })).toBe(0)
    expect(await prisma.oAuthToken.count({ where: { grantId: grant.id } })).toBe(0)
    expect(await prisma.investorInterest.count({ where: { investorId: alice.id } })).toBe(0)
    expect(await prisma.workspaceMembership.count({ where: { userId: alice.id } })).toBe(0)
    expect(await prisma.candidatureNote.findUnique({ where: { id: note.id } })).toMatchObject({
      authorId: null,
      body: 'Note de la structure',
    })
    await prisma.oAuthClient.delete({ where: { id: client.id } })
    // The structure's records: the conseiller's account untouched.
    expect(await prisma.user.count({ where: { id: conseiller.id } })).toBe(1)
  })

  it('refuses while a share is open, and sees a share created while it waited for the lock (R53)', async () => {
    const admin = await user('admin', 'admin')
    const carol = await user('carol')
    const { dossier } = await requestOf(carol)
    const requestId = await pendingFor(carol)

    // A share being created holds the request's row (FOR KEY SHARE) until it commits.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let inserted!: () => void
    const insertedNow = new Promise<void>((resolve) => (inserted = resolve))
    const creating = prisma.$transaction(
      async (tx) => {
        await tx.shareLink.create({
          data: {
            dossierId: dossier.id,
            recipientEmail: `dan-${tag}@pg-test.dev`,
            token: randomUUID(),
            status: 'active',
          },
        })
        inserted()
        await gate
      },
      { timeout: 20_000 },
    )
    await insertedNow
    const completing = deletions.complete(admin, requestId)
    await new Promise((r) => setTimeout(r, 300))
    release()
    await creating
    const [result] = await Promise.allSettled([completing])
    expect(outcome(result)).toBe('409 DELETION_BLOCKED')
    expect(await prisma.user.count({ where: { id: carol.id } })).toBe(1)
    const request = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
    })
    expect(request.status).toBe('pending')
  })

  it('two administrators at once: one deletes, the other is told it is decided', async () => {
    const [first, second] = [await user('admin', 'admin'), await user('admin', 'admin')]
    const erin = await user('erin')
    await requestOf(erin)
    const requestId = await pendingFor(erin)
    const results = await Promise.allSettled([
      deletions.complete(first, requestId),
      deletions.complete(second, requestId),
    ])
    expect(results.map(outcome).sort()).toEqual(['409 DELETION_REQUEST_DECIDED', 'fulfilled'])
    expect(
      await prisma.auditLog.count({
        where: {
          actionType: 'account_deleted',
          metadata: { path: ['requestId'], equals: requestId },
        },
      }),
    ).toBe(1)
  })

  it('a withdrawal and a deletion at once: exactly one applies', async () => {
    const admin = await user('admin', 'admin')
    const fay = await user('fay')
    const requestId = await pendingFor(fay)
    const results = await Promise.allSettled([
      deletions.complete(admin, requestId),
      deletions.cancel(fay),
    ])
    const outcomes = results.map(outcome)
    expect(outcomes.filter((o) => o === 'fulfilled')).toHaveLength(1)
    const request = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
    })
    const exists = (await prisma.user.count({ where: { id: fay.id } })) === 1
    expect(['completed', 'cancelled']).toContain(request.status)
    expect(exists).toBe(request.status === 'cancelled')
  })

  it('asked twice at once, one pending request; the database refuses a second one', async () => {
    const gus = await user('gus')
    const [a, b] = await Promise.all([deletions.request(gus), deletions.request(gus)])
    expect(a.id).toBe(b.id)
    expect(
      await prisma.accountDeletionRequest.count({ where: { userId: gus.id, status: 'pending' } }),
    ).toBe(1)
    await expect(
      prisma.accountDeletionRequest.create({
        data: { userId: gus.id, subjectRef: 'compte-supprime-x', status: 'pending' },
      }),
    ).rejects.toThrow()
    // A completed request never points to an account (CHECK).
    await expect(
      prisma.accountDeletionRequest.update({
        where: { id: a.id },
        data: { status: 'completed', decidedAt: new Date(), summary: {} },
      }),
    ).rejects.toThrow()
  })

  it('the platform’s last administrator is never deleted', async () => {
    // Every other administrator of this disposable database deactivated for the test.
    const others = await prisma.user.findMany({ where: { role: 'admin', isActive: true } })
    await prisma.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { isActive: false },
    })
    try {
      const last = await user('last', 'admin')
      const requestId = await pendingFor(last)
      const deciding = await user('deciding', 'admin')
      await prisma.user.update({ where: { id: deciding.id }, data: { isActive: false } })
      const [result] = await Promise.allSettled([deletions.complete(deciding, requestId)])
      expect(outcome(result)).toBe('409 DELETION_BLOCKED')
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { isActive: true },
      })
    }
  })

  it('purges what is expired, nothing else, once — even twice at once', async () => {
    const now = new Date()
    const ago = (days: number) => new Date(now.getTime() - days * DAY)
    const hana = await user('hana')
    const old = await prisma.magicLinkToken.create({
      data: { userId: hana.id, token: randomUUID(), expiresAt: ago(2) },
    })
    const fresh = await prisma.magicLinkToken.create({
      data: { userId: hana.id, token: randomUUID(), expiresAt: ago(-1) },
    })
    const oldSession = await prisma.refreshSession.create({
      data: { userId: hana.id, familyId: randomUUID(), expiresAt: ago(31) },
    })
    const revokedSession = await prisma.refreshSession.create({
      data: { userId: hana.id, familyId: randomUUID(), expiresAt: ago(-3), revokedAt: ago(1) },
    })
    const client = await prisma.oAuthClient.create({
      data: {
        id: `client-${tag}-${randomUUID()}`,
        source: 'dcr',
        name: 'Claude',
        redirectUris: [],
        metadata: {},
      },
    })
    const endedGrant = await prisma.oAuthGrant.create({
      data: {
        userId: hana.id,
        clientId: client.id,
        scopes: [],
        resource: 'r',
        expiresAt: ago(-60),
        revokedAt: ago(31),
      },
    })
    const liveGrant = await prisma.oAuthGrant.create({
      data: {
        userId: hana.id,
        clientId: client.id,
        scopes: [],
        resource: 'r',
        expiresAt: ago(-60),
      },
    })
    const oldToken = await prisma.oAuthToken.create({
      data: { grantId: liveGrant.id, kind: 'access', tokenHash: randomUUID(), expiresAt: ago(31) },
    })
    const liveToken = await prisma.oAuthToken.create({
      data: {
        grantId: liveGrant.id,
        kind: 'refresh',
        tokenHash: randomUUID(),
        expiresAt: ago(-20),
      },
    })
    const note = (readAt: Date | null, createdAt: Date, n: number) =>
      prisma.notification.create({
        data: {
          recipientId: hana.id,
          kind: 'share_revoked',
          dedupKey: `k-${n}-${randomUUID()}`,
          subjectKey: 's',
          payload: { dossierName: 'X' },
          emailState: 'none',
          emailStateAt: createdAt,
          readAt,
          createdAt,
        },
      })
    const oldRead = await note(ago(170), ago(181), 1)
    const oldUnread = await note(null, ago(400), 2)
    const recentRead = await note(ago(1), ago(10), 3)
    const oldEntry = await prisma.auditLog.create({
      data: {
        actionType: 'share_link_viewed',
        actorId: hana.id,
        metadata: { ip: '203.0.113.9', userAgent: 'X', matched: true },
        createdAt: ago(366),
      },
    })
    const recentEntry = await prisma.auditLog.create({
      data: {
        actionType: 'share_link_viewed',
        actorId: hana.id,
        metadata: { ip: '203.0.113.9' },
        createdAt: ago(10),
      },
    })
    const { workspace } = await workspaceWithForm()
    const decider = await user('decider', 'financeur')
    const refused = await prisma.entrepreneurAccessRequest.create({
      data: {
        workspaceId: workspace.id,
        email: `ivy-${tag}@pg-test.dev`,
        name: 'Ivy',
        companyName: 'Ivy SAS',
        lastSubmittedAt: ago(400),
        status: 'refused',
        decidedAt: ago(366),
        decidedById: decider.id,
      },
    })
    const pending = await prisma.entrepreneurAccessRequest.create({
      data: {
        workspaceId: workspace.id,
        email: `jay-${tag}@pg-test.dev`,
        name: 'Jay',
        companyName: 'Jay SAS',
        lastSubmittedAt: ago(400),
      },
    })

    const [a, b] = await Promise.all([retention.purge(now), retention.purge(now)])
    const total = (k: 'magicLinks' | 'readNotifications' | 'journalEntriesStripped') => a[k] + b[k]
    expect(total('magicLinks')).toBeGreaterThanOrEqual(1)
    const exists = {
      oldLink: await prisma.magicLinkToken.count({ where: { id: old.id } }),
      freshLink: await prisma.magicLinkToken.count({ where: { id: fresh.id } }),
      oldSession: await prisma.refreshSession.count({ where: { id: oldSession.id } }),
      revokedSession: await prisma.refreshSession.count({ where: { id: revokedSession.id } }),
      endedGrant: await prisma.oAuthGrant.count({ where: { id: endedGrant.id } }),
      liveGrant: await prisma.oAuthGrant.count({ where: { id: liveGrant.id } }),
      oldToken: await prisma.oAuthToken.count({ where: { id: oldToken.id } }),
      liveToken: await prisma.oAuthToken.count({ where: { id: liveToken.id } }),
      oldRead: await prisma.notification.count({ where: { id: oldRead.id } }),
      oldUnread: await prisma.notification.count({ where: { id: oldUnread.id } }),
      recentRead: await prisma.notification.count({ where: { id: recentRead.id } }),
      refused: await prisma.entrepreneurAccessRequest.count({ where: { id: refused.id } }),
      pending: await prisma.entrepreneurAccessRequest.count({ where: { id: pending.id } }),
    }
    expect(exists).toEqual({
      oldLink: 0,
      freshLink: 1,
      oldSession: 0,
      revokedSession: 1,
      endedGrant: 0,
      liveGrant: 1,
      oldToken: 0,
      liveToken: 1,
      oldRead: 0,
      oldUnread: 1,
      recentRead: 1,
      refused: 0,
      pending: 1,
    })
    expect(
      (await prisma.auditLog.findUniqueOrThrow({ where: { id: oldEntry.id } })).metadata,
    ).toEqual({
      matched: true,
    })
    expect(
      (await prisma.auditLog.findUniqueOrThrow({ where: { id: recentEntry.id } })).metadata,
    ).toEqual({ ip: '203.0.113.9' })
    // Idempotent: run again, nothing of these is left to delete.
    const again = await retention.purge(now)
    expect(await prisma.magicLinkToken.count({ where: { id: { in: [old.id] } } })).toBe(0)
    expect(again.journalEntriesStripped).toBe(0)
    await prisma.oAuthClient.delete({ where: { id: client.id } })
  })

  it('deletes a stored file only once no document refers to it', async () => {
    const kim = await user('kim')
    const { company, dossier } = await requestOf(kim, 'Kimtech')
    const shared = `documents/${tag}/${randomUUID()}`
    const library = await prisma.libraryDocument.create({
      data: { companyId: company.id, filename: 'a.pdf' },
    })
    const first = await prisma.document.create({
      data: {
        libraryDocumentId: library.id,
        companyId: company.id,
        filename: 'a.pdf',
        mimetype: 'application/pdf',
        storageKey: shared,
        size: 1,
      },
    })
    // Version 2 brings version 1 back: the same object.
    await prisma.document.create({
      data: {
        libraryDocumentId: library.id,
        companyId: company.id,
        filename: 'a.pdf',
        mimetype: 'application/pdf',
        storageKey: shared,
        size: 1,
        version: 2,
        restoredFromId: first.id,
      },
    })
    await storage.upload(shared, Buffer.from('a'), 'application/pdf')
    await prisma.document.delete({ where: { id: first.id } })
    expect(await prisma.storageDeletion.count({ where: { storageKey: shared } })).toBe(1)
    const kept = await cleanup.drain()
    expect(kept.stillReferenced).toBeGreaterThanOrEqual(1)
    expect(await storage.exists(shared)).toBe(true)
    expect(await prisma.storageDeletion.count({ where: { storageKey: shared } })).toBe(0)
    // The request deleted by its owner (the company with it): the file goes.
    await prisma.dossier.delete({ where: { id: dossier.id } })
    await prisma.company.delete({ where: { id: company.id } })
    expect(await prisma.storageDeletion.count({ where: { storageKey: shared } })).toBe(1)
    await cleanup.drain()
    expect(await storage.exists(shared)).toBe(false)
    // A rolled-back deletion queues nothing.
    const other = await requestOf(kim, 'Kimbis')
    const key = `documents/${tag}/${randomUUID()}`
    const lib = await prisma.libraryDocument.create({
      data: { companyId: other.company.id, filename: 'b.pdf' },
    })
    const doc = await prisma.document.create({
      data: {
        libraryDocumentId: lib.id,
        companyId: other.company.id,
        filename: 'b.pdf',
        mimetype: 'application/pdf',
        storageKey: key,
        size: 1,
      },
    })
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.document.delete({ where: { id: doc.id } })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await prisma.storageDeletion.count({ where: { storageKey: key } })).toBe(0)
  })

  // The migration: replayable on a partly migrated database, undone only with the loss accepted.
  it('migration: applies again as it is, and refuses to undo while a request would be lost', async () => {
    const mia = await user('mia')
    await deletions.request(mia)
    class RolledBack extends Error {}
    await expect(
      prisma.$transaction(
        async (tx) => {
          const constraints = () =>
            tx.$queryRawUnsafe<Array<{ c: string }>>(
              `SELECT conname || ':' || pg_get_constraintdef(oid) AS c FROM pg_constraint
               WHERE conrelid::regclass::text IN ('account_deletion_requests', 'storage_deletions', 'notifications')
               ORDER BY 1`,
            )
          const before = await constraints()
          for (const sql of privacyUp()) await tx.$executeRawUnsafe(sql)
          expect(await constraints()).toEqual(before)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          let refused: unknown = null
          try {
            for (const sql of privacyDown()) await tx.$executeRawUnsafe(sql)
          } catch (err) {
            refused = err
          }
          expect(String(refused)).toMatch(/personal data records would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await tx.$executeRawUnsafe("SET LOCAL confluent.accept_privacy_loss = 'on'")
          for (const sql of privacyDown()) await tx.$executeRawUnsafe(sql)
          const gone = await tx.$queryRawUnsafe<Array<{ t: string | null }>>(
            `SELECT to_regclass('account_deletion_requests')::text AS t`,
          )
          expect(gone).toEqual([{ t: null }])
          for (const sql of privacyUp()) await tx.$executeRawUnsafe(sql)
          expect(await constraints()).toEqual(before)
          throw new RolledBack()
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow(RolledBack)
  })
})
