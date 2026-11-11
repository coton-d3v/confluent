import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type ClassificationRule, type QuestionnaireField } from '@prisma/client'
import {
  CLASSIFICATION_DIMENSIONS,
  classificationRuleProblem,
  type ClassificationCoverage,
  type ClassificationDimensionKey,
  type CoverageIssue,
  type CreateClassificationRuleInput,
  type UpdateClassificationRuleInput,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import { DOSSIER_FORM, QuestionnairesService } from '../questionnaires/questionnaires.service'
import { isKnownDimension } from './classification.rules'

// Classification rules as data (ROADMAP E03.12): editing them never touches a dossier; dossiers are
// reclassified only through ReclassificationService, explicitly.
@Injectable()
export class ClassificationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaires: QuestionnairesService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<ClassificationRule[]> {
    return this.prisma.classificationRule.findMany({
      orderBy: [
        { dimension: 'asc' },
        { position: 'asc' },
        { fieldKey: 'asc' },
        { choiceKey: 'asc' },
      ],
    })
  }

  async create(input: CreateClassificationRuleInput, actorId: string): Promise<ClassificationRule> {
    assertFits(input)
    const duplicate = await this.prisma.classificationRule.findFirst({
      where: { dimension: input.dimension, fieldKey: input.fieldKey, choiceKey: input.choiceKey },
    })
    if (duplicate) throw ruleExists()
    let rule: ClassificationRule
    try {
      rule = await this.prisma.classificationRule.create({ data: input })
    } catch (err) {
      // Two concurrent creations: the unique index lets only one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ruleExists()
      }
      throw err
    }
    await this.trace(actorId, 'created', rule)
    return rule
  }

  async update(
    id: string,
    input: UpdateClassificationRuleInput,
    actorId: string,
  ): Promise<ClassificationRule> {
    const existing = await this.find(id)
    const next = { ...existing, ...definedOnly(input) }
    assertFits({ ...next, dimension: existing.dimension as ClassificationDimensionKey })
    const rule = await this.prisma.classificationRule.update({
      where: { id },
      data: definedOnly(input),
    })
    await this.trace(actorId, 'updated', rule, existing)
    return rule
  }

  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.find(id)
    await this.prisma.classificationRule.deleteMany({ where: { id } })
    await this.trace(actorId, 'deleted', existing)
  }

  // Gaps between the rules and the dossier form, for its published version and its draft: what a
  // form change would make the classification miss.
  async coverage(): Promise<ClassificationCoverage> {
    const [rules, form] = await Promise.all([
      this.prisma.classificationRule.findMany(),
      this.prisma.questionnaire.findFirst({
        where: { usage: DOSSIER_FORM.usage, workspaceId: null },
      }),
    ])
    if (!form) return { versions: [] }
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: form.id, status: { in: ['published', 'draft'] } },
      orderBy: { version: 'asc' },
    })
    const result: ClassificationCoverage = { versions: [] }
    for (const version of versions) {
      const structure = await this.questionnaires.getVersion(version.id)
      result.versions.push({
        versionId: version.id,
        version: version.version,
        status: version.status,
        issues: coverageIssues(rules, structure?.fields ?? []),
      })
    }
    return result
  }

  private async find(id: string): Promise<ClassificationRule> {
    const rule = await this.prisma.classificationRule.findUnique({ where: { id } })
    if (!rule)
      throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'Règle introuvable.' })
    return rule
  }

  private trace(
    actorId: string,
    change: string,
    rule: ClassificationRule,
    before?: ClassificationRule,
  ) {
    const pick = (r: ClassificationRule) => ({
      dimension: r.dimension,
      fieldKey: r.fieldKey,
      choiceKey: r.choiceKey,
      value: r.value,
      position: r.position,
    })
    return this.audit.record({
      actionType: 'classification_rules_updated',
      actorId,
      metadata: {
        change,
        ruleId: rule.id,
        rule: pick(rule),
        ...(before ? { before: pick(before) } : {}),
      },
    })
  }
}

const ruleExists = () =>
  new ConflictException({
    code: 'RULE_EXISTS',
    message: 'Une règle existe déjà pour ce champ et ce choix dans cette dimension.',
  })

function assertFits(rule: {
  dimension: ClassificationDimensionKey
  choiceKey: string
  value: string
}) {
  const problem = classificationRuleProblem(rule)
  if (problem) throw new BadRequestException({ code: 'INVALID_RULE', message: problem })
}

const definedOnly = <T extends object>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>

export function coverageIssues(
  rules: readonly ClassificationRule[],
  fields: readonly QuestionnaireField[],
): CoverageIssue[] {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const issues: CoverageIssue[] = []
  const seenMissingField = new Set<string>()
  for (const rule of rules) {
    if (!isKnownDimension(rule.dimension)) continue
    const dimension = CLASSIFICATION_DIMENSIONS[rule.dimension]
    const field = byKey.get(rule.fieldKey)
    if (!field) {
      const id = `${rule.dimension}:${rule.fieldKey}`
      if (!seenMissingField.has(id)) {
        seenMissingField.add(id)
        issues.push({
          kind: 'missing_field',
          dimension: rule.dimension,
          fieldKey: rule.fieldKey,
          choiceKey: '',
          message: `« ${dimension.label} » lit le champ « ${rule.fieldKey} », absent de cette version.`,
        })
      }
      continue
    }
    const choices = readChoices(field.choices)
    if (rule.choiceKey && choices.length > 0 && !choices.some((c) => c.key === rule.choiceKey)) {
      issues.push({
        kind: 'missing_choice',
        dimension: rule.dimension,
        fieldKey: rule.fieldKey,
        choiceKey: rule.choiceKey,
        message: `« ${dimension.label} » attend le choix « ${rule.choiceKey} », absent du champ « ${field.label} ».`,
      })
    }
  }
  // A `choice` dimension must give a value for every choice of the fields it reads.
  for (const [dimensionKey, dimension] of Object.entries(CLASSIFICATION_DIMENSIONS)) {
    if (dimension.kind !== 'choice') continue
    const dimensionRules = rules.filter((r) => r.dimension === dimensionKey)
    for (const fieldKey of new Set(dimensionRules.map((r) => r.fieldKey))) {
      const field = byKey.get(fieldKey)
      if (!field) continue
      for (const choice of readChoices(field.choices)) {
        if (dimensionRules.some((r) => r.fieldKey === fieldKey && r.choiceKey === choice.key))
          continue
        issues.push({
          kind: 'unmapped_choice',
          dimension: dimensionKey as ClassificationDimensionKey,
          fieldKey,
          choiceKey: choice.key,
          message: `Le choix « ${choice.label} » du champ « ${field.label} » ne donne aucune valeur pour « ${dimension.label} ».`,
        })
      }
    }
  }
  return issues
}
