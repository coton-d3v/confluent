import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Dossier, DossierAnswer, DossierAnswerRevision, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ClassificationService,
  storedClassification,
} from '../classification/classification.service'
import { lockDossier } from '../dossiers/dossier-lock'
import {
  declarationErrors,
  keepsRevision,
  provenanceColumns,
  provenanceView,
  revisionOf,
  type AnswerAuthor,
  type AnswerDeclaration,
  type AnswerProvenanceView,
  type CheckedSource,
} from './answer-provenance'
import { AnswerSourcesService } from './answer-sources.service'
import { normalizeAnswers, submittedDossierErrors, validateAnswers } from './answer-validation'
import { InvalidAnswersException } from './invalid-answers.exception'

export interface AnswerInput extends AnswerDeclaration {
  fieldId: string
  value: string
}

// A state an answer held before it gave way (E04.05).
export interface AnswerRevisionView {
  value: string
  provenance: AnswerProvenanceView | null
  replacedAt: Date
}

// An answer as the API returns it: its provenance (E04.04) and history (E04.05) only for the
// dossier's owner.
export interface AnswerView {
  id: string
  dossierId: string
  fieldId: string
  value: string
  createdAt: Date
  updatedAt: Date
  provenance?: AnswerProvenanceView | null
  history?: AnswerRevisionView[]
}

// What a reader sees of each answer: a shared reader the value only; the owner its provenance too,
// and in the site its history (the MCP shows the provenance only).
export type AnswerDetail = 'value' | 'provenance' | 'history'

@Injectable()
export class AnswersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
    private readonly sources: AnswerSourcesService,
  ) {}

  listForDossier(dossierId: string): Promise<DossierAnswer[]> {
    return this.prisma.dossierAnswer.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async listViews(dossierId: string, detail: AnswerDetail): Promise<AnswerView[]> {
    return this.views(dossierId, await this.listForDossier(dossierId), detail)
  }

  async views(
    dossierId: string,
    rows: DossierAnswer[],
    detail: AnswerDetail,
  ): Promise<AnswerView[]> {
    if (detail === 'value') return rows.map((row) => answerView(row))
    const [documents, revisions] = await Promise.all([
      this.prisma.document.findMany({ where: { dossierId } }),
      detail === 'history' && rows.length
        ? this.prisma.dossierAnswerRevision.findMany({
            where: { answerId: { in: rows.map((r) => r.id) } },
            orderBy: { replacedAt: 'desc' },
          })
        : Promise.resolve([] as DossierAnswerRevision[]),
    ])
    const byId = new Map(documents.map((d) => [d.id, d]))
    return rows.map((row) => {
      const view = answerView(row, provenanceView(row, row.updatedAt, byId))
      if (detail !== 'history') return view
      const history = revisions
        .filter((r) => r.answerId === row.id)
        .map((r) => ({
          value: r.value,
          provenance: provenanceView(r, r.recordedAt, byId),
          replacedAt: r.replacedAt,
        }))
      return { ...view, history }
    })
  }

  // The only way to write answers (site, admin, MCP): every field must belong to the dossier's own
  // questionnaire version and every value must fit its type — all or nothing. A submitted dossier
  // keeps all its required answers. The state is read under the dossier's lock, never taken from
  // the caller's earlier read (code review R40). Each value is stored with its provenance (E04.04):
  // `author` says who writes and through which channel; a cited source is checked beforehand,
  // outside the lock (reading a document may take a while).
  async saveForDossier(
    dossier: Pick<Dossier, 'id'>,
    answers: AnswerInput[],
    author: AnswerAuthor,
  ): Promise<DossierAnswer[]> {
    const cited = await this.sources.check(dossier.id, answers)
    return this.prisma.$transaction(async (tx) => {
      const current = await lockDossier(tx, dossier.id)
      const fields = await tx.questionnaireField.findMany({
        where: { versionId: current.questionnaireVersionId },
      })
      const normalized = normalizeAnswers(fields, answers)
      const errors = validateAnswers(fields, normalized)
      if (current.submittedAt) errors.push(...submittedDossierErrors(fields, normalized))
      const labels = new Map(fields.map((f) => [f.id, f.label]))
      for (const e of [...declarationErrors(answers), ...cited.errors]) {
        errors.push({ ...e, label: labels.get(e.fieldId) })
      }
      if (errors.length) throw new InvalidAnswersException(errors)
      const saved = await upsertMany(tx, current.id, normalized, author, cited.sources)
      // A submitted dossier is classified: its derived data follows its answers at once, whatever
      // the path of the change (site, admin, MCP — code review R18). A draft is classified when
      // submitted.
      if (current.submittedAt) {
        const classification = await this.classification.evaluate(current.id, tx)
        if (classification) {
          await tx.dossier.update({
            where: { id: current.id },
            data: storedClassification(classification),
          })
        }
      }
      return saved
    })
  }

  // The owner confirms an AI proposal as it was shown to them (E04.05): same value and source, now
  // confirmed by them through `author`'s channel; the pending state goes to the history. Under the
  // dossier's lock, like any write: nothing is confirmed if the answer changed since it was shown
  // (`expected`), or is no proposal waiting for confirmation.
  async confirmProposal(
    dossier: Pick<Dossier, 'id'>,
    fieldId: string,
    expected: { value: string; updatedAt: Date },
    author: AnswerAuthor,
  ): Promise<DossierAnswer> {
    return this.prisma.$transaction(async (tx) => {
      await lockDossier(tx, dossier.id)
      const current = await tx.dossierAnswer.findUnique({
        where: { dossierId_fieldId: { dossierId: dossier.id, fieldId } },
      })
      if (!current) {
        throw new NotFoundException({ code: 'ANSWER_NOT_FOUND', message: 'Réponse introuvable.' })
      }
      if (
        current.value !== expected.value ||
        current.updatedAt.getTime() !== expected.updatedAt.getTime()
      ) {
        throw new ConflictException({
          code: 'ANSWER_CHANGED',
          message:
            'Cette réponse a changé depuis son affichage. Vérifiez la valeur actuelle avant de la confirmer.',
        })
      }
      if (current.origin !== 'ai' || current.confirmation !== 'pending') {
        throw new ConflictException({
          code: 'NOT_A_PROPOSAL',
          message: 'Cette réponse n’est pas une proposition à confirmer.',
        })
      }
      await tx.dossierAnswerRevision.create({ data: revisionOf(current) })
      return tx.dossierAnswer.update({
        where: { id: current.id },
        data: {
          confirmation: 'confirmed',
          channel: author.channel,
          authorId: author.userId,
          clientName: author.channel === 'mcp' ? (author.clientName ?? null) : null,
        },
      })
    })
  }
}

function answerView(row: DossierAnswer, provenance?: AnswerProvenanceView | null): AnswerView {
  const { id, dossierId, fieldId, value, createdAt, updatedAt } = row
  const view: AnswerView = { id, dossierId, fieldId, value, createdAt, updatedAt }
  return provenance === undefined ? view : { ...view, provenance }
}

async function upsertMany(
  tx: Prisma.TransactionClient,
  dossierId: string,
  answers: AnswerInput[],
  author: AnswerAuthor,
  sources: Array<CheckedSource | null>,
): Promise<DossierAnswer[]> {
  const previous = new Map(
    (
      await tx.dossierAnswer.findMany({
        where: { dossierId, fieldId: { in: answers.map((a) => a.fieldId) } },
      })
    ).map((row) => [row.fieldId, row]),
  )
  // One statement at a time: an interactive transaction runs on a single connection.
  const saved: DossierAnswer[] = []
  for (const [i, a] of answers.entries()) {
    // The provenance is the new value's: a source cited for an earlier value does not stay — the
    // state it replaces goes to the history when an AI assistant is involved (E04.05).
    const provenance = provenanceColumns(a, author, sources[i])
    const before = previous.get(a.fieldId)
    if (before && keepsRevision(before, { value: a.value, ...provenance })) {
      await tx.dossierAnswerRevision.create({ data: revisionOf(before) })
    }
    const row = await tx.dossierAnswer.upsert({
      where: { dossierId_fieldId: { dossierId, fieldId: a.fieldId } },
      create: { dossierId, fieldId: a.fieldId, value: a.value, ...provenance },
      update: { value: a.value, ...provenance },
    })
    previous.set(a.fieldId, row)
    saved.push(row)
  }
  return saved
}
