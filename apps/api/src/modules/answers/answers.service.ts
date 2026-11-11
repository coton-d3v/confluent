import { Injectable } from '@nestjs/common'
import type { Dossier, DossierAnswer, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ClassificationService,
  storedClassification,
} from '../classification/classification.service'
import { lockDossier } from '../dossiers/dossier-lock'
import {
  declarationErrors,
  provenanceColumns,
  provenanceView,
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

// An answer as the API returns it: its provenance only for the dossier's owner (E04.04).
export interface AnswerView {
  id: string
  dossierId: string
  fieldId: string
  value: string
  createdAt: Date
  updatedAt: Date
  provenance?: AnswerProvenanceView | null
}

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

  // With their provenance when `withProvenance` (the owner): shared readers never see it.
  async listViews(dossierId: string, withProvenance: boolean): Promise<AnswerView[]> {
    return this.views(dossierId, await this.listForDossier(dossierId), withProvenance)
  }

  async views(
    dossierId: string,
    rows: DossierAnswer[],
    withProvenance: boolean,
  ): Promise<AnswerView[]> {
    if (!withProvenance) return rows.map((row) => answerView(row))
    const documents = await this.prisma.document.findMany({ where: { dossierId } })
    const byId = new Map(documents.map((d) => [d.id, d]))
    return rows.map((row) => answerView(row, provenanceView(row, byId)))
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
  // One statement at a time: an interactive transaction runs on a single connection.
  const saved: DossierAnswer[] = []
  for (const [i, a] of answers.entries()) {
    // The provenance is the new value's: a source cited for an earlier value does not stay.
    const provenance = provenanceColumns(a, author, sources[i])
    saved.push(
      await tx.dossierAnswer.upsert({
        where: { dossierId_fieldId: { dossierId, fieldId: a.fieldId } },
        create: { dossierId, fieldId: a.fieldId, value: a.value, ...provenance },
        update: { value: a.value, ...provenance },
      }),
    )
  }
  return saved
}
