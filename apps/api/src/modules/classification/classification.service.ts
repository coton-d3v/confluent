import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { ClassificationResult } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import {
  classifyAnswers,
  EMPTY_CLASSIFICATION,
  type ClassifiedAnswer,
} from './classification.rules'

export type { ClassificationResult } from '@confluent/shared'

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name)

  constructor(private readonly prisma: PrismaService) {}

  // What the current rules give for a dossier, without writing anything; null if it does not exist.
  // `db`: the transaction of a caller holding the dossier (submission, R40), else the client.
  async compute(
    dossierId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ClassificationResult | null> {
    const dossier = await db.dossier.findUnique({
      where: { id: dossierId },
      include: { questionnaireVersion: { include: { fields: true } }, answers: true },
    })
    const rules = await db.classificationRule.findMany()
    if (!dossier) return null

    // Answers by field key, never by label: labels are editable in the builder.
    const valueByFieldId = new Map(dossier.answers.map((a) => [a.fieldId, a.value]))
    const answers = new Map<string, ClassifiedAnswer>()
    for (const field of dossier.questionnaireVersion.fields) {
      const value = valueByFieldId.get(field.id)
      if (!field.key || value == null || value.trim() === '') continue
      const choice = readChoices(field.choices).find((c) => c.key === value)
      answers.set(field.key, { value, label: choice?.label ?? value })
    }
    return classifyAnswers(answers, rules, (dimension, fieldKey, value) =>
      this.logger.warn(
        `classify: dossier ${dossierId} — no "${dimension}" rule for "${fieldKey}" = ${JSON.stringify(value)}`,
      ),
    )
  }

  // Computes and stores the classification (at submission).
  async classify(dossierId: string): Promise<ClassificationResult> {
    const result = await this.compute(dossierId)
    if (!result) {
      this.logger.warn(`classify: dossier ${dossierId} not found`)
      return { ...EMPTY_CLASSIFICATION }
    }
    await this.prisma.dossier.update({ where: { id: dossierId }, data: result })
    return result
  }
}
