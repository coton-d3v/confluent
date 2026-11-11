import { Test } from '@nestjs/testing'
import { AnswersService } from './answers.service'
import { PrismaService } from '../../prisma/prisma.service'
import { InvalidAnswersException } from './invalid-answers.exception'
import { ClassificationService } from '../classification/classification.service'
import { AnswerSourcesService } from './answer-sources.service'

const SITE = { userId: 'u-1', channel: 'site' } as const
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
  it('lists answers scoped to the dossier', async () => {
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

    await svc.listForDossier('d-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { dossierId: 'd-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  // The dossier's state is the one stored, read under its lock — never the caller's copy (R40).
  async function build(
    stored: { submittedAt: Date | null } = { submittedAt: null },
    checked: Awaited<ReturnType<AnswerSourcesService['check']>> | null = null,
  ) {
    const dossier = { id: 'd-1', questionnaireVersionId: 'v-1', ...stored }
    const upsert = jest.fn((args: { where: { dossierId_fieldId: { fieldId: string } } }) =>
      Promise.resolve({ id: `a-${args.where.dossierId_fieldId.fieldId}` }),
    )
    const lock = jest.fn().mockResolvedValue([])
    const fieldsFindMany = jest.fn().mockResolvedValue(FIELDS)
    const dossierUpdate = jest.fn().mockResolvedValue(dossier)
    const compute = jest
      .fn()
      .mockResolvedValue({ result: { sector: 'SaaS' }, sources: { sector: ['secteur'] } })
    const tx = {
      $queryRaw: lock,
      dossier: { findUnique: jest.fn().mockResolvedValue(dossier), update: dossierUpdate },
      dossierAnswer: { upsert },
      questionnaireField: { findMany: fieldsFindMany },
    }
    const transaction = jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    const check = jest.fn((_dossierId: string, answers: unknown[]) =>
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
    }
  }

  it('saves valid answers idempotently inside a transaction, checked against the dossier version', async () => {
    const { svc, upsert, transaction, fieldsFindMany, lock } = await build()
    const result = await svc.saveForDossier(
      { id: 'd-1' },
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
      where: { dossierId_fieldId: { dossierId: 'd-1', fieldId: 'f-1' } },
      create: { dossierId: 'd-1', fieldId: 'f-1', value: 'hello', ...HUMAN_SITE },
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
      { id: 'd-1' },
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
    await svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: 'Biosensio SAS' }], SITE)
    expect(upsert).toHaveBeenCalledTimes(1)

    const attempt = svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: '  ' }], SITE)
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
    await draft.svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: '' }], SITE)
    expect(draft.compute).not.toHaveBeenCalled()
  })

  it('reclassifies a submitted dossier in the same transaction as the change (R18)', async () => {
    const { svc, compute, dossierUpdate, tx } = await build({ submittedAt: new Date() })
    await svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: 'Biosensio SAS' }], SITE)
    expect(compute).toHaveBeenCalledWith('d-1', tx)
    expect(dossierUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { sector: 'SaaS', classificationSources: { sector: ['secteur'] } },
    })
  })

  it('judges by the stored state, not by a copy read before the submission (R40)', async () => {
    const { svc, upsert } = await build({ submittedAt: new Date() })
    const readBefore = { id: 'd-1', questionnaireVersionId: 'v-1', submittedAt: null }
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
      await svc.saveForDossier({ id: 'd-1' }, answers, MCP)
      expect(check).toHaveBeenCalledWith('d-1', answers)
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
      await svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: 'x' }], {
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
        { id: 'd-1' },
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
        dossierId: 'd-1',
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

      const owner = await svc.listViews('d-1', true)
      expect(documents).toHaveBeenCalledWith({ where: { dossierId: 'd-1' } })
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
      const shared = await svc.listViews('d-1', false)
      expect(shared.map((a) => Object.keys(a))).toEqual(
        rows.map(() => ['id', 'dossierId', 'fieldId', 'value', 'createdAt', 'updatedAt']),
      )
    })
  })
})
