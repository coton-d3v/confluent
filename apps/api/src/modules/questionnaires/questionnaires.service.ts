import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  Prisma,
  QuestionnaireField,
  QuestionnaireSection,
  QuestionnaireVersion,
  field_type,
} from '@prisma/client'
import type { AccessLevel } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { QUESTIONNAIRE_V1_FIELDS } from './questionnaire.seed'
import { createVersionStructure } from './questionnaire-structure'

// The form whose published version every new dossier is created with (E03.09 will let several
// forms coexist per usage; today there is one per usage).
export const DOSSIER_FORM = {
  slug: 'profil-entreprise',
  name: "Profil de l'entreprise",
  usage: 'dossier',
}

export interface CreateVersionFieldInput {
  section: string
  key?: string
  label: string
  fieldType: field_type
  options?: string[]
  required: boolean
  orderIndex: number
  minAccessLevel?: AccessLevel
}

export interface UpdateFieldInput {
  label?: string
  fieldType?: field_type
  required?: boolean
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

  async ensureBootstrap(): Promise<QuestionnaireVersion> {
    const published = await this.prisma.questionnaireVersion.findFirst({
      where: { status: 'published', questionnaire: { usage: DOSSIER_FORM.usage } },
      orderBy: { version: 'desc' },
    })
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

  listVersions(): Promise<QuestionnaireVersion[]> {
    return this.prisma.questionnaireVersion.findMany({
      where: { questionnaire: { usage: DOSSIER_FORM.usage } },
      orderBy: { version: 'desc' },
    })
  }

  // Publishes a complete new version: the previous published one is archived in the same
  // transaction, so there is always exactly one published version.
  async createVersion(fields: CreateVersionFieldInput[]): Promise<QuestionnaireVersion> {
    return this.prisma.$transaction(async (tx) => {
      const form = await this.dossierForm(tx)
      const previous = await tx.questionnaireVersion.findFirst({
        where: { questionnaireId: form.id },
        orderBy: { version: 'desc' },
      })
      await tx.questionnaireVersion.updateMany({
        where: { questionnaireId: form.id, status: 'published' },
        data: { status: 'archived' },
      })
      const version = await tx.questionnaireVersion.create({
        data: {
          questionnaireId: form.id,
          version: (previous?.version ?? 0) + 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
      await createVersionStructure(tx, version.id, fields)
      return version
    })
  }

  async updateField(
    versionId: string,
    fieldId: string,
    patch: UpdateFieldInput,
  ): Promise<QuestionnaireField> {
    const existing = await this.prisma.questionnaireField.findUnique({
      where: { id: fieldId },
    })
    if (!existing || existing.versionId !== versionId) {
      throw new NotFoundException({ code: 'FIELD_NOT_FOUND', message: 'Field not found.' })
    }
    return this.prisma.questionnaireField.update({
      where: { id: fieldId },
      data: patch,
    })
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
