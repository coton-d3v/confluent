import { Test } from '@nestjs/testing'
import { AnswersService } from './answers.service'
import { PrismaService } from '../../prisma/prisma.service'
import { InvalidAnswersException } from './invalid-answers.exception'

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
        {
          provide: PrismaService,
          useValue: { dossierAnswer: { findMany } },
        },
      ],
    }).compile()
    const svc = moduleRef.get(AnswersService)

    await svc.listForDossier('d-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { dossierId: 'd-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  async function build() {
    const upsert = jest.fn((args: unknown) => ({ kind: 'op', args }))
    const transaction = jest.fn().mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }])
    const fieldsFindMany = jest.fn().mockResolvedValue(FIELDS)
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnswersService,
        {
          provide: PrismaService,
          useValue: {
            dossierAnswer: { upsert },
            questionnaireField: { findMany: fieldsFindMany },
            $transaction: transaction,
          },
        },
      ],
    }).compile()
    return { svc: moduleRef.get(AnswersService), upsert, transaction, fieldsFindMany }
  }

  it('saves valid answers idempotently inside a transaction, checked against the dossier version', async () => {
    const { svc, upsert, transaction, fieldsFindMany } = await build()
    const result = await svc.saveForDossier(
      { id: 'd-1', questionnaireVersionId: 'v-1', submittedAt: null },
      [
        { fieldId: 'f-1', value: 'hello' },
        { fieldId: 'f-2', value: 'MVP' },
      ],
    )
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
    const { svc, upsert, transaction } = await build()
    const attempt = svc.saveForDossier(
      { id: 'd-1', questionnaireVersionId: 'v-1', submittedAt: null },
      [
        { fieldId: 'f-1', value: 'ok' },
        { fieldId: 'f-2', value: 'Série Z' },
        { fieldId: 'f-from-v2', value: 'x' },
      ],
    )
    await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
    await attempt.catch((err: InvalidAnswersException) => {
      expect(err.errors.map((e) => e.fieldId)).toEqual(['f-2', 'f-from-v2'])
    })
    expect(upsert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('lets a submitted dossier correct a required answer but not clear it', async () => {
    const { svc, upsert } = await build()
    const submitted = { id: 'd-1', questionnaireVersionId: 'v-1', submittedAt: new Date() }
    await svc.saveForDossier(submitted, [{ fieldId: 'f-1', value: 'Biosensio SAS' }])
    expect(upsert).toHaveBeenCalledTimes(1)

    const attempt = svc.saveForDossier(submitted, [{ fieldId: 'f-1', value: '  ' }])
    await expect(attempt).rejects.toBeInstanceOf(InvalidAnswersException)
    await attempt.catch((err: InvalidAnswersException) => {
      expect(err.errors).toEqual([
        expect.objectContaining({
          fieldId: 'f-1',
          message: expect.stringContaining('pas effacée'),
        }),
      ])
    })
    // Not submitted yet: clearing is a normal draft edit.
    await svc.saveForDossier({ ...submitted, submittedAt: null }, [{ fieldId: 'f-1', value: '' }])
  })
})
