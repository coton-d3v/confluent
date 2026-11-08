import { Injectable } from '@nestjs/common'
import type { ClassificationResult, ReclassificationPreview } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { classificationChanges } from './classification.rules'
import { ClassificationService } from './classification.service'

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

// Submitted dossiers are classified once, at submission; changing the rules never rewrites them
// silently (E03.12). An administrator previews what the current rules would change, then applies it.
@Injectable()
export class ReclassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
    private readonly audit: AuditService,
  ) {}

  async preview(): Promise<ReclassificationPreview> {
    const dossiers = await this.prisma.dossier.findMany({
      where: { submittedAt: { not: null } },
      select: { id: true, name: true, ...COLUMNS },
      orderBy: { submittedAt: 'asc' },
    })
    const changed: ReclassificationPreview['dossiers'] = []
    for (const dossier of dossiers) {
      const next = await this.classification.compute(dossier.id)
      if (!next) continue
      const changes = classificationChanges(currentOf(dossier), next)
      if (changes.length > 0) changed.push({ dossierId: dossier.id, name: dossier.name, changes })
    }
    return { checked: dossiers.length, dossiers: changed }
  }

  // Recomputes and stores, then traces each changed dossier with its before/after values.
  async apply(actorId: string): Promise<ReclassificationPreview> {
    const preview = await this.preview()
    for (const { dossierId, changes } of preview.dossiers) {
      await this.classification.classify(dossierId)
      await this.audit.record({
        actionType: 'dossier_classified',
        actorId,
        dossierId,
        metadata: { reason: 'classification_rules_updated', changes },
      })
    }
    return preview
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
