import { Injectable } from '@nestjs/common'
import type {
  Prisma,
  Questionnaire,
  QuestionnaireField,
  QuestionnaireSection,
  QuestionnaireVersion,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { QUESTIONNAIRE_V1_FIELDS } from './questionnaire.seed'
import { createVersionStructure } from './questionnaire-structure'

// The form assigned to the `dossier` usage: new dossiers are created with its published version.
// Other forms exist unassigned until E03.09 lets an administrator assign them. One of Confluent's
// own forms (`workspaceId` null), never a workspace's (E05.09).
export const DOSSIER_FORM = {
  slug: 'profil-entreprise',
  name: "Profil de l'entreprise",
  usage: 'dossier',
}

// A version with its ordered sections and fields (fields ordered by section, then position).
export interface VersionStructure {
  version: QuestionnaireVersion
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
}

const FIELD_ORDER: Prisma.QuestionnaireFieldOrderByWithRelationInput[] = [
  { section: { orderIndex: 'asc' } },
  { orderIndex: 'asc' },
]

@Injectable()
export class QuestionnairesService {
  constructor(private readonly prisma: PrismaService) {}

  // Published version of the dossier form; bootstraps V1 on an empty database.
  async getActive(): Promise<VersionStructure> {
    const version = await this.ensureBootstrap()
    return (await this.getVersion(version.id))!
  }

  // The form a project owner answers — the dossier form and its published version — as an AI
  // application describes it (E04.01). Reading it is not designing forms: no form design right is
  // needed, and nothing else (other forms, drafts, archived versions) is reachable from here.
  async getActiveForm(): Promise<VersionStructure & { form: Questionnaire }> {
    const structure = await this.getActive()
    const form = await this.prisma.questionnaire.findUnique({
      where: { id: structure.version.questionnaireId },
    })
    return { form: form!, ...structure }
  }

  async ensureBootstrap(): Promise<QuestionnaireVersion> {
    // Confluent's own form (E05.09: a workspace's forms never serve the company profile).
    const form = await this.prisma.questionnaire.findFirst({
      where: { usage: DOSSIER_FORM.usage, workspaceId: null },
    })
    const published =
      form &&
      (await this.prisma.questionnaireVersion.findFirst({
        where: { questionnaireId: form.id, status: 'published' },
      }))
    return published ?? (await this.seedVersion1())
  }

  async getVersion(id: string): Promise<VersionStructure | null> {
    const version = await this.prisma.questionnaireVersion.findUnique({ where: { id } })
    if (!version) return null
    const [sections, fields] = await Promise.all([
      this.prisma.questionnaireSection.findMany({
        where: { versionId: id },
        orderBy: { orderIndex: 'asc' },
      }),
      this.prisma.questionnaireField.findMany({ where: { versionId: id }, orderBy: FIELD_ORDER }),
    ])
    return { version, sections, fields }
  }

  private async seedVersion1(): Promise<QuestionnaireVersion> {
    return this.prisma.$transaction(async (tx) => {
      const form = await this.dossierForm(tx)
      const version = await tx.questionnaireVersion.create({
        data: {
          questionnaireId: form.id,
          version: 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
      await createVersionStructure(tx, version.id, QUESTIONNAIRE_V1_FIELDS)
      return version
    })
  }

  private dossierForm(tx: Prisma.TransactionClient) {
    return tx.questionnaire.upsert({
      where: { slug: DOSSIER_FORM.slug },
      create: DOSSIER_FORM,
      update: {},
    })
  }
}
