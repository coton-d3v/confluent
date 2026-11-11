import { ConflictException, Injectable } from '@nestjs/common'
import type { ClassificationRule, Prisma } from '@prisma/client'
import type { ClassificationResult, ReclassificationPreview } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { lockProfile } from '../dossiers/dossier-profile'
import { rulesRevision } from './classification-sources'
import { classificationChanges } from './classification.rules'
import { ClassificationService, storedClassification } from './classification.service'

const COLUMNS = {
  sector: true,
  maturityStage: true,
  ancrageCvl: true,
  tagTechnologique: true,
  axe1Projet: true,
  axe2Financier: true,
  axe3Origine: true,
  deeptechScore: true,
  preCreation: true,
} as const

type Changed = ReclassificationPreview['dossiers']

// Submitted dossiers are classified once, at submission; changing the rules never rewrites them
// silently (E03.12). An administrator previews what the current rules would change, then applies
// exactly that set of rules (code review R44): the preview carries the rules' revision, the
// application refuses another one, and the trace holds the values actually written.
@Injectable()
export class ReclassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
    private readonly audit: AuditService,
  ) {}

  async preview(): Promise<ReclassificationPreview> {
    const rules = await this.prisma.classificationRule.findMany()
    const dossiers = await this.submittedDossiers(this.prisma)
    const changed: Changed = []
    for (const dossier of dossiers) {
      const next = await this.classification.evaluate(dossier.companyId, this.prisma, rules)
      if (!next) continue
      const changes = classificationChanges(currentOf(dossier), next.result)
      if (changes.length > 0) changed.push({ dossierId: dossier.id, name: dossier.name, changes })
    }
    return { checked: dossiers.length, dossiers: changed, rulesRevision: rulesRevision(rules) }
  }

  // In one transaction: the rules are held against changes (SHARE lock: rule edits wait for the
  // end), each dossier's profile is held while it is recomputed and written, so a concurrent answer
  // change is either included or applied after.
  async apply(actorId: string, expectedRevision: string): Promise<ReclassificationPreview> {
    const applied = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "classification_rules" IN SHARE MODE`
        const rules = await tx.classificationRule.findMany()
        const revision = rulesRevision(rules)
        if (revision !== expectedRevision) {
          throw new ConflictException({
            code: 'CLASSIFICATION_RULES_CHANGED',
            message: 'Les règles ont changé depuis l’aperçu : vérifiez à nouveau leur effet.',
          })
        }
        const dossiers = await this.submittedDossiers(tx)
        const changed: Changed = []
        for (const { id } of dossiers) {
          const change = await this.reclassify(tx, id, rules)
          if (change) changed.push(change)
        }
        return { checked: dossiers.length, dossiers: changed, rulesRevision: revision }
      },
      { timeout: 60_000 },
    )
    for (const { dossierId, changes } of applied.dossiers) {
      await this.audit.record({
        actionType: 'dossier_classified',
        actorId,
        dossierId,
        metadata: {
          reason: 'classification_rules_updated',
          rulesRevision: applied.rulesRevision,
          changes,
        },
      })
    }
    return applied
  }

  private async reclassify(
    tx: Prisma.TransactionClient,
    dossierId: string,
    rules: ReadonlyArray<ClassificationRule>,
  ): Promise<Changed[number] | null> {
    const current = await lockProfile(tx, dossierId)
    const next = await this.classification.evaluate(current.companyId, tx, rules)
    if (!next) return null
    const changes = classificationChanges(currentOf(current), next.result)
    if (changes.length === 0) return null
    await tx.dossier.update({ where: { id: dossierId }, data: storedClassification(next) })
    return { dossierId, name: current.name, changes }
  }

  private submittedDossiers(db: Prisma.TransactionClient) {
    return db.dossier.findMany({
      where: { submittedAt: { not: null } },
      select: { id: true, companyId: true, name: true, ...COLUMNS },
      orderBy: { submittedAt: 'asc' },
    })
  }
}

function currentOf(r: ClassificationResult): ClassificationResult {
  return {
    sector: r.sector,
    maturityStage: r.maturityStage,
    ancrageCvl: r.ancrageCvl,
    tagTechnologique: r.tagTechnologique,
    axe1Projet: r.axe1Projet,
    axe2Financier: r.axe2Financier,
    axe3Origine: r.axe3Origine,
    deeptechScore: r.deeptechScore,
    preCreation: r.preCreation,
  }
}
