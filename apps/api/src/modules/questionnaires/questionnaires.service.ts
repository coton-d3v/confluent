import { Injectable, NotFoundException } from '@nestjs/common'
import type { field_type, QuestionnaireField, QuestionnaireVersion } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { QUESTIONNAIRE_V1_FIELDS } from './questionnaire.seed'

export interface CreateVersionFieldInput {
  section: string
  key?: string
  label: string
  fieldType: field_type
  options?: string[]
  required: boolean
  orderIndex: number
}

export interface UpdateFieldInput {
  label?: string
  fieldType?: field_type
  required?: boolean
}

export interface ActiveQuestionnaire {
  version: QuestionnaireVersion
  fields: QuestionnaireField[]
}

@Injectable()
export class QuestionnairesService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<ActiveQuestionnaire> {
    let version = await this.prisma.questionnaireVersion.findFirst({
      where: { isPublished: true },
      orderBy: { version: 'desc' },
    })
    if (!version) {
      version = await this.seedVersion1()
    }
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: version.id },
      orderBy: [{ section: 'asc' }, { orderIndex: 'asc' }],
    })
    return { version, fields }
  }

  async ensureBootstrap(): Promise<QuestionnaireVersion> {
    const existing = await this.prisma.questionnaireVersion.findFirst({
      where: { isPublished: true },
      orderBy: { version: 'desc' },
    })
    return existing ?? (await this.seedVersion1())
  }

  async getVersion(id: string): Promise<ActiveQuestionnaire | null> {
    const version = await this.prisma.questionnaireVersion.findUnique({ where: { id } })
    if (!version) return null
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: version.id },
      orderBy: [{ section: 'asc' }, { orderIndex: 'asc' }],
    })
    return { version, fields }
  }

  listVersions(): Promise<QuestionnaireVersion[]> {
    return this.prisma.questionnaireVersion.findMany({
      orderBy: { version: 'desc' },
    })
  }

  async createVersion(fields: CreateVersionFieldInput[]): Promise<QuestionnaireVersion> {
    const previous = await this.prisma.questionnaireVersion.findFirst({
      orderBy: { version: 'desc' },
    })
    const nextVersion = (previous?.version ?? 0) + 1
    return this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.questionnaireVersion.update({
          where: { id: previous.id },
          data: { isPublished: false },
        })
      }
      return tx.questionnaireVersion.create({
        data: {
          version: nextVersion,
          isPublished: true,
          fields: { create: fields },
        },
      })
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
    const version = await this.prisma.questionnaireVersion.create({
      data: {
        version: 1,
        isPublished: true,
        fields: { create: QUESTIONNAIRE_V1_FIELDS },
      },
    })
    return version
  }
}
