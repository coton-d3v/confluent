import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import {
  classifyAnswers,
  EMPTY_CLASSIFICATION,
  type ClassificationResult,
  type ClassifiedAnswer,
} from './classification.rules'

export type { ClassificationResult } from './classification.rules'

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name)

  constructor(private readonly prisma: PrismaService) {}

  async classify(dossierId: string): Promise<ClassificationResult> {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id: dossierId },
      include: {
        questionnaireVersion: { include: { fields: true } },
        answers: true,
      },
    })
    if (!dossier) {
      this.logger.warn(`classify: dossier ${dossierId} not found`)
      return { ...EMPTY_CLASSIFICATION }
    }

    // Answers by field key, never by label: labels are editable in the builder.
    const valueByFieldId = new Map(dossier.answers.map((a) => [a.fieldId, a.value]))
    const answers = new Map<string, ClassifiedAnswer>()
    for (const field of dossier.questionnaireVersion.fields) {
      const value = valueByFieldId.get(field.id)
      if (!field.key || value == null || value === '') continue
      const choice = readChoices(field.choices).find((c) => c.key === value)
      answers.set(field.key, { value, label: choice?.label ?? value })
    }

    const result = classifyAnswers(answers, (fieldKey, value) =>
      this.logger.warn(
        `classify: dossier ${dossierId} — unmapped value for "${fieldKey}": ${JSON.stringify(value)}`,
      ),
    )
    await this.prisma.dossier.update({ where: { id: dossierId }, data: result })
    return result
  }
}
