import { Injectable } from '@nestjs/common'
import type { Dossier, DossierAnswer, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ClassificationService } from '../classification/classification.service'
import { lockDossier } from '../dossiers/dossier-lock'
import { normalizeAnswers, submittedDossierErrors, validateAnswers } from './answer-validation'
import { InvalidAnswersException } from './invalid-answers.exception'

export interface AnswerInput {
  fieldId: string
  value: string
}

@Injectable()
export class AnswersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
  ) {}

  listForDossier(dossierId: string): Promise<DossierAnswer[]> {
    return this.prisma.dossierAnswer.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // The only way to write answers (site, admin, MCP): every field must belong to the dossier's own
  // questionnaire version and every value must fit its type — all or nothing. A submitted dossier
  // keeps all its required answers. The state is read under the dossier's lock, never taken from
  // the caller's earlier read (code review R40).
  async saveForDossier(
    dossier: Pick<Dossier, 'id'>,
    answers: AnswerInput[],
  ): Promise<DossierAnswer[]> {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockDossier(tx, dossier.id)
      const fields = await tx.questionnaireField.findMany({
        where: { versionId: current.questionnaireVersionId },
      })
      const normalized = normalizeAnswers(fields, answers)
      const errors = validateAnswers(fields, normalized)
      if (current.submittedAt) errors.push(...submittedDossierErrors(fields, normalized))
      if (errors.length) throw new InvalidAnswersException(errors)
      const saved = await upsertMany(tx, current.id, normalized)
      // A submitted dossier is classified: its derived data follows its answers at once, whatever
      // the path of the change (site, admin, MCP — code review R18). A draft is classified when
      // submitted.
      if (current.submittedAt) {
        const classification = await this.classification.compute(current.id, tx)
        if (classification)
          await tx.dossier.update({ where: { id: current.id }, data: classification })
      }
      return saved
    })
  }
}

async function upsertMany(
  tx: Prisma.TransactionClient,
  dossierId: string,
  answers: AnswerInput[],
): Promise<DossierAnswer[]> {
  // One statement at a time: an interactive transaction runs on a single connection.
  const saved: DossierAnswer[] = []
  for (const a of answers) {
    saved.push(
      await tx.dossierAnswer.upsert({
        where: { dossierId_fieldId: { dossierId, fieldId: a.fieldId } },
        create: { dossierId, fieldId: a.fieldId, value: a.value },
        update: { value: a.value },
      }),
    )
  }
  return saved
}
