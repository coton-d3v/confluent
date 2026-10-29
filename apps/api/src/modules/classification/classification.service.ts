import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CLASSIFICATION_KEYS as K } from './classification.keys'

function computeAncrage(val: string | null): string | null {
  if (!val) return null
  if (val.startsWith('Mon projet est basé')) return 'ancré'
  if (val.startsWith('Je cherche à')) return 'en_cours'
  if (val.startsWith('Je découvre')) return 'découverte'
  return null
}

function computeAxe2(val: string | null): number | null {
  if (!val) return null
  if (val.startsWith('Fonds propres')) return 2
  if (val.startsWith('Love money')) return 3
  if (val.startsWith('Seed')) return 4
  if (val.startsWith('Pré-Série A')) return 5
  return null
}

function computeAxe3(val: string | null): number | null {
  if (!val) return null
  if (val.startsWith('Projet créé ex nihilo')) return 1
  if (val.startsWith("Spin-off d'une entreprise")) return 2
  if (val.startsWith("Spin-off d'un laboratoire")) return 3
  if (val.startsWith("Reprise d'entreprise")) return 4
  if (val.startsWith('Pivot')) return 5
  return null
}

function computeAxe1(val: string | null): number | null {
  if (!val) return null
  if (val === 'Idée') return 1
  if (val === 'Concept validé') return 2
  if (val === 'MVP') return 3
  if (val === 'Premiers clients') return 4
  if (val === 'Croissance') return 5
  if (val.startsWith('TRL 1-3')) return 1
  if (val.startsWith('TRL 4-6')) return 3
  if (val.startsWith('TRL 7-9')) return 5
  return null
}

export interface ClassificationResult {
  sector: string | null
  maturityStage: string | null
  ancrageCvl: string | null
  tagTechnologique: string | null
  axe1Projet: number | null
  axe2Financier: number | null
  axe3Origine: number | null
  deeptechScore: number | null
  preCreation: boolean | null
}

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
      return {
        sector: null,
        maturityStage: null,
        ancrageCvl: null,
        tagTechnologique: null,
        axe1Projet: null,
        axe2Financier: null,
        axe3Origine: null,
        deeptechScore: null,
        preCreation: null,
      }
    }

    const fields = dossier.questionnaireVersion.fields
    // Lookup by technical key, never by label: labels are editable in the builder.
    const fieldIdByKey = new Map<string, string>()
    for (const f of fields) if (f.key) fieldIdByKey.set(f.key, f.id)
    const answers = dossier.answers
    const get = (key: string): string | null => {
      const fieldId = fieldIdByKey.get(key)
      if (!fieldId) return null
      return answers.find((a) => a.fieldId === fieldId)?.value ?? null
    }
    // Option values are still matched on their text: surface any answer the rules don't know
    // (e.g. an option renamed in the questionnaire) instead of silently dropping it.
    const warnUnmapped = <T>(key: string, value: string | null, mapped: T | null): T | null => {
      if (value != null && mapped == null) {
        this.logger.warn(
          `classify: dossier ${dossierId} — unmapped value for "${key}": ${JSON.stringify(value)}`,
        )
      }
      return mapped
    }

    const stadeV2 = get(K.stade)
    const sector = get(K.secteur) ?? get(K.secteurActivite)
    const maturityStage = stadeV2 ?? get(K.stadeMaturite)

    const ancrageVal = get(K.ancrage)
    const ancrageCvl = warnUnmapped(K.ancrage, ancrageVal, computeAncrage(ancrageVal))

    const structureVal = get(K.structure)
    const preCreation =
      structureVal != null
        ? structureVal === 'Non' || structureVal === 'En cours de création'
        : null

    const financementVal = get(K.financement)
    const axe2Financier = warnUnmapped(K.financement, financementVal, computeAxe2(financementVal))
    const origineVal = get(K.origine)
    const axe3Origine = warnUnmapped(K.origine, origineVal, computeAxe3(origineVal))
    const axe1Projet = warnUnmapped(K.stade, stadeV2, computeAxe1(stadeV2))

    // deeptech score
    const technoVal = get(K.techno)
    let tagTechnologique: string | null = null
    let deeptechScore: number | null = null

    if (technoVal != null) {
      if (technoVal.startsWith('Non')) {
        tagTechnologique = 'non_tech'
        deeptechScore = 0
      } else {
        let score = 0
        if (origineVal?.startsWith("Spin-off d'un laboratoire")) score++
        const brevetsVal = get(K.brevets)
        if (brevetsVal === 'Oui déposés' || brevetsVal === 'En cours') score++
        const verrouVal = get(K.verrou)
        if (verrouVal === 'Oui') score++
        const rdVal = get(K.rdPublic)
        if (rdVal === 'Oui' || rdVal === 'En cours') score++
        deeptechScore = score
        tagTechnologique = score >= 2 ? 'deeptech' : 'tech'
      }
    }

    const result: ClassificationResult = {
      sector,
      maturityStage,
      ancrageCvl,
      tagTechnologique,
      axe1Projet,
      axe2Financier,
      axe3Origine,
      deeptechScore,
      preCreation,
    }

    await this.prisma.dossier.update({
      where: { id: dossierId },
      data: result,
    })

    return result
  }
}
