import { Test } from '@nestjs/testing'
import { AnswersService } from './answers.service'
import { PrismaService } from '../../prisma/prisma.service'
import { InvalidAnswersException } from './invalid-answers.exception'
import { ClassificationService } from '../classification/classification.service'

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
  async function build(stored: { submittedAt: Date | null } = { submittedAt: null }) {
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
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnswersService,
        { provide: PrismaService, useValue: { $transaction: transaction } },
        { provide: ClassificationService, useValue: { evaluate: compute } },
      ],
    }).compile()
    return {
      svc: moduleRef.get(AnswersService),
      ...{ upsert, transaction, fieldsFindMany, lock, dossier, compute, dossierUpdate, tx },
    }
  }

  it('saves valid answers idempotently inside a transaction, checked against the dossier version', async () => {
    const { svc, upsert, transaction, fieldsFindMany, lock } = await build()
    const result = await svc.saveForDossier({ id: 'd-1' }, [
      { fieldId: 'f-1', value: 'hello' },
      { fieldId: 'f-2', value: 'MVP' },
    ])
    expect(lock).toHaveBeenCalledTimes(1)
    expect(fieldsFindMany).toHaveBeenCalledWith({ where: { versionId: 'v-1' } })
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: { dossierId_fieldId: { dossierId: 'd-1', fieldId: 'f-1' } },
      create: { dossierId: 'd-1', fieldId: 'f-1', value: 'hello' },
      update: { value: 'hello' },
    })
    // A list answer given by its exact label is stored as the choice key.
    expect(upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ update: { value: 'mvp' } }))
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)
  })

  it('writes nothing when one answer is invalid or targets another version', async () => {
    const { svc, upsert } = await build()
    const attempt = svc.saveForDossier({ id: 'd-1' }, [
      { fieldId: 'f-1', value: 'ok' },
      { fieldId: 'f-2', value: 'Série Z' },
      { fieldId: 'f-from-v2', value: 'x' },
    ])
    await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
    await attempt.catch((err: InvalidAnswersException) => {
      expect(err.errors.map((e) => e.fieldId)).toEqual(['f-2', 'f-from-v2'])
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('lets a submitted dossier correct a required answer but not clear it', async () => {
    const { svc, upsert } = await build({ submittedAt: new Date() })
    await svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: 'Biosensio SAS' }])
    expect(upsert).toHaveBeenCalledTimes(1)

    const attempt = svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: '  ' }])
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
    await draft.svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: '' }])
    expect(draft.compute).not.toHaveBeenCalled()
  })

  it('reclassifies a submitted dossier in the same transaction as the change (R18)', async () => {
    const { svc, compute, dossierUpdate, tx } = await build({ submittedAt: new Date() })
    await svc.saveForDossier({ id: 'd-1' }, [{ fieldId: 'f-1', value: 'Biosensio SAS' }])
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
      svc.saveForDossier(readBefore, [{ fieldId: 'f-1', value: '' }]),
    ).rejects.toBeInstanceOf(InvalidAnswersException)
    expect(upsert).not.toHaveBeenCalled()
  })
})
