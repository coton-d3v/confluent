import { Injectable, Logger } from '@nestjs/common'
import type { ClassificationRule, Prisma } from '@prisma/client'
import type { ClassificationResult } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import {
  classifyAnswers,
  EMPTY_CLASSIFICATION,
  type ClassifiedAnswer,
} from './classification.rules'
import { classificationSources, type ClassificationSources } from './classification-sources'

export type { ClassificationResult } from '@confluent/shared'

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name)

  constructor(private readonly prisma: PrismaService) {}

  // What the rules give for a dossier, without writing anything; null if it does not exist.
  // `db`: the transaction of a caller holding the dossier (R40), else the client. `rules`: a set
  // loaded once by the caller, so that a whole operation uses the same rules (R44).
  async evaluate(
    dossierId: string,
    db: Prisma.TransactionClient = this.prisma,
    rules?: ReadonlyArray<ClassificationRule>,
  ): Promise<ClassificationComputation | null> {
    const dossier = await db.dossier.findUnique({
      where: { id: dossierId },
      include: { questionnaireVersion: { include: { fields: true } }, answers: true },
    })
    const applied = rules ?? (await db.classificationRule.findMany())
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
    const result = classifyAnswers(answers, applied, (dimension, fieldKey, value) =>
      this.logger.warn(
        `classify: dossier ${dossierId} — no "${dimension}" rule for "${fieldKey}" = ${JSON.stringify(value)}`,
      ),
    )
    const versionKeys = new Set(dossier.questionnaireVersion.fields.flatMap((f) => f.key ?? []))
    return { result, sources: classificationSources(applied, versionKeys) }
  }

  async compute(
    dossierId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ClassificationResult | null> {
    return (await this.evaluate(dossierId, db))?.result ?? null
  }

  // Computes and stores the classification with its provenance.
  async classify(dossierId: string): Promise<ClassificationResult> {
    const computed = await this.evaluate(dossierId)
    if (!computed) {
      this.logger.warn(`classify: dossier ${dossierId} not found`)
      return { ...EMPTY_CLASSIFICATION }
    }
    await this.prisma.dossier.update({
      where: { id: dossierId },
      data: storedClassification(computed),
    })
    return computed.result
  }
}

export interface ClassificationComputation {
  result: ClassificationResult
  sources: ClassificationSources
}

// The columns written on the dossier: the values and the field keys they were computed from (R31).
export function storedClassification({ result, sources }: ClassificationComputation) {
  return { ...result, classificationSources: sources as Prisma.InputJsonObject }
}
