import { Test } from '@nestjs/testing'
import { AnswersService } from './answers.service'
import { PrismaService } from '../../prisma/prisma.service'
import { InvalidAnswersException } from './invalid-answers.exception'
import { ClassificationService } from '../classification/classification.service'
import { AnswerSourcesService } from './answer-sources.service'

const SITE = { userId: 'u-1', channel: 'site' } as const
// A dossier and its company, whose profile it presents (E05.05).
const D1 = { id: 'd-1', companyId: 'c-1' }
const HUMAN_SITE = {
  origin: 'human',
  confirmation: 'confirmed',
  channel: 'site',
  authorId: 'u-1',
  clientName: null,
  sourceDocumentId: null,
  sourceLocation: null,
  sourceExcerpt: null,
}

const FIELDS = [
  { id: 'f-1', versionId: 'v-1', label: 'Nom', fieldType: 'text', choices: [], required: true },
  {
    id: 'f-2',
    versionId: 'v-1',
    label: 'Stade',
    fieldType: 'select',
    choices: [
      { key: 'mvp', label: 'MVP' },
      { key: 'seed', label: 'Seed' },
    ],
  },
]

describe('AnswersService', () => {
  it('lists the answers of the dossier’s company profile', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnswersService,
        { provide: PrismaService, useValue: { dossierAnswer: { findMany } } },
        { provide: ClassificationService, useValue: {} },
        { provide: AnswerSourcesService, useValue: {} },
      ],
    }).compile()
    const svc = moduleRef.get(AnswersService)

    await svc.listForDossier(D1)
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'c-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  // The dossier's state is the one stored, read under its profile's lock — never the caller's copy
  // (R40). `submittedDossiers`: how many dossiers of its company are submitted (E05.05).
  async function build(
    stored: { submittedAt: Date | null; submittedDossiers?: number } = { submittedAt: null },
    checked: Awaited<ReturnType<AnswerSourcesService['check']>> | null = null,
    // The answers already stored (E04.05: what a write replaces).
    previous: Array<Record<string, unknown>> = [],
  ) {
    const { submittedDossiers = stored.submittedAt ? 1 : 0, ...state } = stored
    const dossier = { ...D1, questionnaireVersionId: 'v-1', ...state }
    const upsert = jest.fn((args: { where: { companyId_fieldId: { fieldId: string } } }) =>
      Promise.resolve({ id: `a-${args.where.companyId_fieldId.fieldId}` }),
    )
    const lock = jest.fn().mockResolvedValue([])
    const fieldsFindMany = jest.fn().mockResolvedValue(FIELDS)
    const dossierUpdate = jest.fn().mockResolvedValue({ count: submittedDossiers })
    const dossierCount = jest.fn().mockResolvedValue(submittedDossiers)
    const compute = jest
      .fn()
      .mockResolvedValue({ result: { sector: 'SaaS' }, sources: { sector: ['secteur'] } })
    const revisionCreate = jest.fn().mockResolvedValue({})
    const answerUpdate = jest.fn((args: { data: object }) =>
      Promise.resolve({ ...previous[0], ...args.data }),
    )
    const tx = {
      $queryRaw: lock,
      dossier: {
        findUnique: jest.fn().mockResolvedValue(dossier),
        count: dossierCount,
        updateMany: dossierUpdate,
      },
      dossierAnswer: {
        upsert,
        findMany: jest.fn().mockResolvedValue(previous),
        findUnique: jest.fn().mockResolvedValue(previous[0] ?? null),
        update: answerUpdate,
      },
      dossierAnswerRevision: { create: revisionCreate },
      questionnaireField: { findMany: fieldsFindMany },
    }
    const transaction = jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    const check = jest.fn((_dossier: unknown, answers: unknown[]) =>
      Promise.resolve(checked ?? { sources: answers.map(() => null), errors: [] }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnswersService,
        { provide: PrismaService, useValue: { $transaction: transaction } },
        { provide: ClassificationService, useValue: { evaluate: compute } },
        { provide: AnswerSourcesService, useValue: { check } },
      ],
    }).compile()
    return {
      svc: moduleRef.get(AnswersService),
      ...{ upsert, transaction, fieldsFindMany, lock, dossier, compute, dossierUpdate, tx, check },
      dossierCount,
      ...{ revisionCreate, answerUpdate },
    }
  }

  it('saves valid answers idempotently inside a transaction, checked against the dossier version', async () => {
    const { svc, upsert, transaction, fieldsFindMany, lock } = await build()
    const result = await svc.saveForDossier(
      D1,
      [
        { fieldId: 'f-1', value: 'hello' },
        { fieldId: 'f-2', value: 'MVP' },
      ],
      SITE,
    )
    expect(lock).toHaveBeenCalledTimes(1)
    expect(fieldsFindMany).toHaveBeenCalledWith({ where: { versionId: 'v-1' } })
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: { companyId_fieldId: { companyId: 'c-1', fieldId: 'f-1' } },
      create: { companyId: 'c-1', fieldId: 'f-1', value: 'hello', ...HUMAN_SITE },
      update: { value: 'hello', ...HUMAN_SITE },
    })
    // A list answer given by its exact label is stored as the choice key.
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ update: { value: 'mvp', ...HUMAN_SITE } }),
    )
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)
  })

  it('writes nothing when one answer is invalid or targets another version', async () => {
    const { svc, upsert } = await build()
    const attempt = svc.saveForDossier(
      D1,
      [
        { fieldId: 'f-1', value: 'ok' },
        { fieldId: 'f-2', value: 'Série Z' },
        { fieldId: 'f-from-v2', value: 'x' },
      ],
      SITE,
    )
    await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
    await attempt.catch((err: InvalidAnswersException) => {
      expect(err.errors.map((e) => e.fieldId)).toEqual(['f-2', 'f-from-v2'])
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('lets a submitted dossier correct a required answer but not clear it', async () => {
    const { svc, upsert } = await build({ submittedAt: new Date() })
    await svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'Biosensio SAS' }], SITE)
    expect(upsert).toHaveBeenCalledTimes(1)

    const attempt = svc.saveForDossier(D1, [{ fieldId: 'f-1', value: '  ' }], SITE)
    await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
    await attempt.catch((err: InvalidAnswersException) => {
      expect(err.errors).toEqual([
        expect.objectContaining({
          fieldId: 'f-1',
          message: expect.stringContaining('pas effacée'),
        }),
      ])
    })
    // Not submitted yet: clearing is a normal draft edit, and a draft is not classified.
    const draft = await build()
    await draft.svc.saveForDossier(D1, [{ fieldId: 'f-1', value: '' }], SITE)
    expect(draft.compute).not.toHaveBeenCalled()
  })

  it('reclassifies the submitted dossiers of the company in the same transaction as the change (R18)', async () => {
    const { svc, compute, dossierUpdate, dossierCount, tx } = await build({
      submittedAt: new Date(),
    })
    await svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'Biosensio SAS' }], SITE)
    const submitted = { companyId: 'c-1', submittedAt: { not: null } }
    expect(dossierCount).toHaveBeenCalledWith({ where: submitted })
    expect(compute).toHaveBeenCalledWith('c-1', tx)
    expect(dossierUpdate).toHaveBeenCalledWith({
      where: submitted,
      data: { sector: 'SaaS', classificationSources: { sector: ['secteur'] } },
    })
  })

  it('keeps the required answers of a profile once any dossier of the company is submitted (E05.05)', async () => {
    // This dossier is a draft, another dossier of the same company was submitted.
    const { svc, upsert, compute } = await build({ submittedAt: null, submittedDossiers: 1 })
    await expect(
      svc.saveForDossier(D1, [{ fieldId: 'f-1', value: '' }], SITE),
    ).rejects.toBeInstanceOf(InvalidAnswersException)
    expect(upsert).not.toHaveBeenCalled()
    await svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'Biosensio SAS' }], SITE)
    expect(compute).toHaveBeenCalledWith('c-1', expect.anything())
  })

  it('judges by the stored state, not by a copy read before the submission (R40)', async () => {
    const { svc, upsert } = await build({ submittedAt: new Date() })
    const readBefore = { ...D1, questionnaireVersionId: 'v-1', submittedAt: null }
    await expect(
      svc.saveForDossier(readBefore, [{ fieldId: 'f-1', value: '' }], SITE),
    ).rejects.toBeInstanceOf(InvalidAnswersException)
    expect(upsert).not.toHaveBeenCalled()
  })

  describe('provenance (E04.04)', () => {
    const MCP = { userId: 'u-1', channel: 'mcp', clientName: 'Claude' } as const
    const SOURCE = { documentId: 'doc-1', location: 'Page 2', excerpt: 'BIOSENSIO SAS' }

    it('records each value with who wrote it, through which application, and its checked source', async () => {
      const { svc, upsert, check } = await build(
        { submittedAt: null },
        { sources: [SOURCE, null, null], errors: [] },
      )
      const answers = [
        {
          fieldId: 'f-1',
          value: 'Biosensio SAS',
          origin: 'ai' as const,
          source: { documentId: 'doc-1', excerpt: 'BIOSENSIO SAS' },
        },
        { fieldId: 'f-2', value: 'mvp', origin: 'ai' as const, confirmedByUser: true },
        { fieldId: 'f-1', value: 'Biosensio', origin: 'human' as const, confirmedByUser: false },
      ]
      await svc.saveForDossier(D1, answers, MCP)
      expect(check).toHaveBeenCalledWith(D1, answers)
      const written = upsert.mock.calls.map(
        ([args]) => (args as unknown as { update: unknown }).update,
      )
      expect(written).toEqual([
        {
          value: 'Biosensio SAS',
          origin: 'ai',
          confirmation: 'pending',
          channel: 'mcp',
          authorId: 'u-1',
          clientName: 'Claude',
          sourceDocumentId: 'doc-1',
          sourceLocation: 'Page 2',
          sourceExcerpt: 'BIOSENSIO SAS',
        },
        expect.objectContaining({ value: 'mvp', origin: 'ai', confirmation: 'confirmed' }),
        // The person's own input is confirmed whatever the client says; no source is kept.
        expect.objectContaining({
          value: 'Biosensio',
          origin: 'human',
          confirmation: 'confirmed',
          sourceDocumentId: null,
        }),
      ])
    })

    it('never names an application for the site or the administration', async () => {
      const { svc, upsert } = await build()
      await svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'x' }], {
        userId: 'admin-1',
        channel: 'admin',
        clientName: 'Claude',
      })
      expect(upsert.mock.calls[0][0]).toMatchObject({
        update: { channel: 'admin', authorId: 'admin-1', clientName: null, origin: 'human' },
      })
    })

    it('refuses an unconfirmed proposal without a source, and an invalid source, writing nothing', async () => {
      const { svc, upsert } = await build(
        { submittedAt: null },
        { sources: [null, null], errors: [{ fieldId: 'f-2', message: 'Source introuvable.' }] },
      )
      const attempt = svc.saveForDossier(
        D1,
        [
          { fieldId: 'f-1', value: 'Deviné', origin: 'ai' },
          { fieldId: 'f-2', value: 'mvp', origin: 'ai', source: { documentId: 'doc-x' } },
        ],
        MCP,
      )
      await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
      await attempt.catch((err: InvalidAnswersException) => {
        expect(err.errors).toEqual([
          expect.objectContaining({
            fieldId: 'f-1',
            label: 'Nom',
            message: expect.stringContaining('sans source'),
          }),
          { fieldId: 'f-2', label: 'Stade', message: 'Source introuvable.' },
        ])
      })
      expect(upsert).not.toHaveBeenCalled()
    })

    it('shows the provenance to the owner only, and none for an answer saved before it was recorded', async () => {
      const at = new Date('2026-11-11T10:00:00Z')
      const row = (fieldId: string, extra: Record<string, unknown>) => ({
        id: `a-${fieldId}`,
        companyId: 'c-1',
        fieldId,
        value: 'v',
        createdAt: at,
        updatedAt: at,
        origin: null,
        confirmation: null,
        channel: null,
        authorId: null,
        clientName: null,
        sourceDocumentId: null,
        sourceLocation: null,
        sourceExcerpt: null,
        ...extra,
      })
      const rows = [
        row('f-old', {}),
        row('f-ai', {
          origin: 'ai',
          confirmation: 'pending',
          channel: 'mcp',
          authorId: 'u-1',
          clientName: 'Claude',
          sourceDocumentId: 'doc-1',
          sourceLocation: 'Page 2',
          sourceExcerpt: 'BIOSENSIO SAS',
        }),
        // An unexpected stored value is not shown as a provenance.
        row('f-odd', { origin: 'robot', confirmation: 'confirmed', channel: 'site' }),
      ]
      const documents = jest
        .fn()
        .mockResolvedValue([{ id: 'doc-1', filename: 'kbis.pdf', version: 2 }])
      const moduleRef = await Test.createTestingModule({
        providers: [
          AnswersService,
          {
            provide: PrismaService,
            useValue: {
              dossierAnswer: { findMany: jest.fn().mockResolvedValue(rows) },
              document: { findMany: documents },
            },
          },
          { provide: ClassificationService, useValue: {} },
          { provide: AnswerSourcesService, useValue: {} },
        ],
      }).compile()
      const svc = moduleRef.get(AnswersService)

      const owner = await svc.listViews(D1, 'provenance')
      expect(documents).toHaveBeenCalledWith({ where: { companyId: 'c-1' } })
      expect(owner.map((a) => a.provenance)).toEqual([
        null,
        {
          origin: 'ai',
          confirmation: 'pending',
          channel: 'mcp',
          authorId: 'u-1',
          clientName: 'Claude',
          recordedAt: at,
          source: {
            documentId: 'doc-1',
            filename: 'kbis.pdf',
            version: 2,
            location: 'Page 2',
            excerpt: 'BIOSENSIO SAS',
          },
        },
        null,
      ])
      const shared = await svc.listViews(D1, 'value')
      expect(shared.map((a) => Object.keys(a))).toEqual(
        rows.map(() => ['id', 'dossierId', 'fieldId', 'value', 'createdAt', 'updatedAt']),
      )
      // Read through the dossier: the company's identifier stays out of the answer.
      expect(shared.map((a) => a.dossierId)).toEqual(rows.map(() => 'd-1'))
    })
  })

  describe('history and confirmation of proposals (E04.05)', () => {
    const MCP = { userId: 'u-1', channel: 'mcp', clientName: 'Claude' } as const
    const SOURCE = { documentId: 'doc-1', location: 'Page 2', excerpt: 'BIOSENSIO SAS' }
    const at = new Date('2026-11-11T10:00:00Z')
    const stored = (fieldId: string, extra: Record<string, unknown>) => ({
      id: `a-${fieldId}`,
      companyId: 'c-1',
      fieldId,
      value: 'Biosensio SAS',
      createdAt: at,
      updatedAt: at,
      origin: 'ai',
      confirmation: 'pending',
      channel: 'mcp',
      authorId: 'u-1',
      clientName: 'Claude',
      sourceDocumentId: 'doc-1',
      sourceLocation: 'Page 2',
      sourceExcerpt: 'BIOSENSIO SAS',
      ...extra,
    })
    const PROPOSAL = stored('f-1', {})
    // The revision keeping `row`: its value and provenance, dated when it was written.
    const kept = (row: ReturnType<typeof stored>) => ({
      data: {
        answerId: row.id,
        value: row.value,
        origin: row.origin,
        confirmation: row.confirmation,
        channel: row.channel,
        authorId: row.authorId,
        clientName: row.clientName,
        sourceDocumentId: row.sourceDocumentId,
        sourceLocation: row.sourceLocation,
        sourceExcerpt: row.sourceExcerpt,
        recordedAt: row.updatedAt,
      },
    })

    it('keeps a proposal the person corrects in the site, with its provenance and date', async () => {
      const { svc, revisionCreate, upsert } = await build({ submittedAt: null }, null, [PROPOSAL])
      await svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'Biosensio' }], SITE)
      expect(revisionCreate).toHaveBeenCalledTimes(1)
      expect(revisionCreate).toHaveBeenCalledWith(kept(PROPOSAL))
      // Kept before the new value replaces it.
      expect(revisionCreate.mock.invocationCallOrder[0]).toBeLessThan(
        upsert.mock.invocationCallOrder[0],
      )
    })

    it('keeps a value replaced by a proposal, even an equal one that becomes unconfirmed', async () => {
      const human = stored('f-1', {
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'site',
        clientName: null,
        sourceDocumentId: null,
        sourceLocation: null,
        sourceExcerpt: null,
      })
      const { svc, revisionCreate } = await build(
        { submittedAt: null },
        { sources: [SOURCE], errors: [] },
        [human],
      )
      await svc.saveForDossier(
        D1,
        [
          {
            fieldId: 'f-1',
            value: 'Biosensio SAS',
            origin: 'ai',
            source: { documentId: 'doc-1', excerpt: 'BIOSENSIO SAS' },
          },
        ],
        MCP,
      )
      expect(revisionCreate).toHaveBeenCalledWith(kept(human))
    })

    it('keeps nothing for the person’s own edits, an empty value, or a proposal sent again unchanged', async () => {
      const human = stored('f-1', {
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'site',
        clientName: null,
        sourceDocumentId: null,
        sourceLocation: null,
        sourceExcerpt: null,
      })
      const edits = await build({ submittedAt: null }, null, [human])
      await edits.svc.saveForDossier(D1, [{ fieldId: 'f-1', value: 'Bio' }], SITE)
      expect(edits.revisionCreate).not.toHaveBeenCalled()

      const empty = await build({ submittedAt: null }, { sources: [SOURCE], errors: [] }, [
        { ...human, value: '' },
      ])
      await empty.svc.saveForDossier(
        D1,
        [{ fieldId: 'f-1', value: 'Biosensio SAS', origin: 'ai', source: { documentId: 'doc-1' } }],
        MCP,
      )
      expect(empty.revisionCreate).not.toHaveBeenCalled()

      const again = await build({ submittedAt: null }, { sources: [SOURCE], errors: [] }, [
        PROPOSAL,
      ])
      await again.svc.saveForDossier(
        D1,
        [
          {
            fieldId: 'f-1',
            value: 'Biosensio SAS',
            origin: 'ai',
            source: { documentId: 'doc-1', excerpt: 'BIOSENSIO SAS' },
          },
        ],
        MCP,
      )
      expect(again.revisionCreate).not.toHaveBeenCalled()
    })

    it('confirms a proposal as shown: same value and source, confirmed in the site, pending state kept', async () => {
      const { svc, revisionCreate, answerUpdate, lock } = await build({ submittedAt: null }, null, [
        PROPOSAL,
      ])
      const confirmed = await svc.confirmProposal(
        D1,
        'f-1',
        { value: 'Biosensio SAS', updatedAt: new Date(at) },
        SITE,
      )
      expect(lock).toHaveBeenCalledTimes(1)
      expect(revisionCreate).toHaveBeenCalledWith(kept(PROPOSAL))
      expect(answerUpdate).toHaveBeenCalledWith({
        where: { id: 'a-f-1' },
        data: { confirmation: 'confirmed', channel: 'site', authorId: 'u-1', clientName: null },
      })
      expect(confirmed).toMatchObject({
        value: 'Biosensio SAS',
        origin: 'ai',
        confirmation: 'confirmed',
        sourceDocumentId: 'doc-1',
        sourceExcerpt: 'BIOSENSIO SAS',
      })
    })

    it('confirms nothing that changed since it was shown, nor what is no pending proposal', async () => {
      const changed = await build({ submittedAt: null }, null, [PROPOSAL])
      for (const expected of [
        { value: 'Biosensio', updatedAt: at },
        { value: 'Biosensio SAS', updatedAt: new Date(at.getTime() + 1) },
      ]) {
        await expect(changed.svc.confirmProposal(D1, 'f-1', expected, SITE)).rejects.toMatchObject({
          status: 409,
          response: expect.objectContaining({ code: 'ANSWER_CHANGED' }),
        })
      }
      const done = await build({ submittedAt: null }, null, [
        stored('f-1', { confirmation: 'confirmed' }),
      ])
      await expect(
        done.svc.confirmProposal(D1, 'f-1', { value: 'Biosensio SAS', updatedAt: at }, SITE),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'NOT_A_PROPOSAL' }),
      })
      const none = await build()
      await expect(
        none.svc.confirmProposal(D1, 'f-1', { value: '', updatedAt: at }, SITE),
      ).rejects.toMatchObject({ status: 404 })
      for (const b of [changed, done, none]) {
        expect(b.revisionCreate).not.toHaveBeenCalled()
        expect(b.answerUpdate).not.toHaveBeenCalled()
      }
    })

    it('shows the owner each answer’s history, newest first, in the site only', async () => {
      const current = stored('f-1', {
        value: 'Biosensio',
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'site',
        clientName: null,
        sourceDocumentId: null,
        sourceLocation: null,
        sourceExcerpt: null,
      })
      const replaced = new Date('2026-11-11T11:00:00Z')
      const revisions = [
        { ...kept(PROPOSAL).data, id: 'r-1', replacedAt: replaced },
        // A value saved before E04.04, replaced by that proposal.
        {
          id: 'r-0',
          answerId: 'a-f-1',
          value: 'Biosensio',
          origin: null,
          confirmation: null,
          channel: null,
          authorId: null,
          clientName: null,
          sourceDocumentId: null,
          sourceLocation: null,
          sourceExcerpt: null,
          recordedAt: new Date('2026-11-01T09:00:00Z'),
          replacedAt: at,
        },
      ]
      const findRevisions = jest.fn().mockResolvedValue(revisions)
      const moduleRef = await Test.createTestingModule({
        providers: [
          AnswersService,
          {
            provide: PrismaService,
            useValue: {
              dossierAnswer: { findMany: jest.fn().mockResolvedValue([current]) },
              dossierAnswerRevision: { findMany: findRevisions },
              document: {
                findMany: jest
                  .fn()
                  .mockResolvedValue([{ id: 'doc-1', filename: 'kbis.pdf', version: 1 }]),
              },
            },
          },
          { provide: ClassificationService, useValue: {} },
          { provide: AnswerSourcesService, useValue: {} },
        ],
      }).compile()
      const svc = moduleRef.get(AnswersService)

      const [site] = await svc.listViews(D1, 'history')
      expect(findRevisions).toHaveBeenCalledWith({
        where: { answerId: { in: ['a-f-1'] } },
        orderBy: { replacedAt: 'desc' },
      })
      expect(site.history).toEqual([
        {
          value: 'Biosensio SAS',
          provenance: {
            origin: 'ai',
            confirmation: 'pending',
            channel: 'mcp',
            authorId: 'u-1',
            clientName: 'Claude',
            recordedAt: at,
            source: {
              documentId: 'doc-1',
              filename: 'kbis.pdf',
              version: 1,
              location: 'Page 2',
              excerpt: 'BIOSENSIO SAS',
            },
          },
          replacedAt: replaced,
        },
        { value: 'Biosensio', provenance: null, replacedAt: at },
      ])
      // The MCP shows the provenance only; a shared reader neither.
      const [mcp] = await svc.listViews(D1, 'provenance')
      expect(mcp).not.toHaveProperty('history')
      expect(findRevisions).toHaveBeenCalledTimes(1)
    })
  })
})
