import { Injectable } from '@nestjs/common'
import type { Dossier, DossierAnswer } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizeAnswers, submittedDossierErrors, validateAnswers } from './answer-validation'
import { InvalidAnswersException } from './invalid-answers.exception'

export interface AnswerInput {
  fieldId: string
  value: string
}

@Injectable()
export class AnswersService {
  constructor(private readonly prisma: PrismaService) {}

  listForDossier(dossierId: string): Promise<DossierAnswer[]> {
    return this.prisma.dossierAnswer.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // The only way to write answers (site, admin, MCP): every field must belong to the dossier's own
  // questionnaire version and every value must fit its type — all or nothing. A submitted dossier
  // keeps all its required answers.
  async saveForDossier(
    dossier: Pick<Dossier, 'id' | 'questionnaireVersionId' | 'submittedAt'>,
    answers: AnswerInput[],
  ): Promise<DossierAnswer[]> {
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: dossier.questionnaireVersionId },
    })
    const normalized = normalizeAnswers(fields, answers)
    const errors = validateAnswers(fields, normalized)
    if (dossier.submittedAt) errors.push(...submittedDossierErrors(fields, normalized))
    if (errors.length) throw new InvalidAnswersException(errors)
    return this.upsertMany(dossier.id, normalized)
  }

  private async upsertMany(dossierId: string, answers: AnswerInput[]): Promise<DossierAnswer[]> {
    const ops = answers.map((a) =>
      this.prisma.dossierAnswer.upsert({
        where: { dossierId_fieldId: { dossierId, fieldId: a.fieldId } },
        create: { dossierId, fieldId: a.fieldId, value: a.value },
        update: { value: a.value },
      }),
    )
    return this.prisma.$transaction(ops)
  }
}
