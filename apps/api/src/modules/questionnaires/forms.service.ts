import { Injectable } from '@nestjs/common'
import type { Prisma, Questionnaire, QuestionnaireVersion } from '@prisma/client'
import type { FormUsage } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FormErrors } from './form-errors'
import { copyVersionStructure, toKey } from './questionnaire-structure'

// A form with its published version and its draft, if any (E03.02).
export interface FormSummaryView {
  id: string
  slug: string
  name: string
  usage: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  published: { id: string; version: number; publishedAt: Date } | null
  draft: { id: string; version: number; updatedAt: Date } | null
}

export interface FormDetailView extends FormSummaryView {
  versions: QuestionnaireVersion[]
}

// Form-level operations of the builder: create, rename, duplicate, archive, restore. Structure
// editing lives in FormDraftsService. Reused as is by the MCP tools (E03.13 → E04).
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<FormSummaryView[]> {
    const [forms, versions] = await Promise.all([
      this.prisma.questionnaire.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.questionnaireVersion.findMany({
        where: { status: { in: ['draft', 'published'] } },
      }),
    ])
    return forms.map((form) =>
      toSummary(
        form,
        versions.filter((v) => v.questionnaireId === form.id),
      ),
    )
  }

  async get(formId: string): Promise<FormDetailView> {
    const form = await this.findForm(formId)
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: formId },
      orderBy: { version: 'desc' },
    })
    return { ...toSummary(form, versions), versions }
  }

  async summary(formId: string): Promise<FormSummaryView> {
    const form = await this.findForm(formId)
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: formId, status: { in: ['draft', 'published'] } },
    })
    return toSummary(form, versions)
  }

  // A new form is unassigned (E03.09 assigns it to a usage) and starts with an empty draft.
  async create(name: string, actorId: string): Promise<FormDetailView> {
    const form = await this.prisma.$transaction(async (tx) => {
      const created = await tx.questionnaire.create({
        data: { slug: await this.freeSlug(tx, name), name, usage: null },
      })
      await tx.questionnaireVersion.create({
        data: { questionnaireId: created.id, version: 1, status: 'draft' },
      })
      return created
    })
    await this.audit.record({
      actionType: 'form_created',
      actorId,
      metadata: { formId: form.id, name },
    })
    return this.get(form.id)
  }

  // The slug is the form's stable identifier: renaming keeps it.
  async rename(formId: string, name: string, actorId: string): Promise<FormDetailView> {
    const form = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEditableForm(tx, formId)
      await tx.questionnaire.update({ where: { id: formId }, data: { name } })
      return locked
    })
    await this.audit.record({
      actionType: 'form_updated',
      actorId,
      metadata: { formId, change: 'renamed', from: form.name, to: name },
    })
    return this.get(formId)
  }

  // Copies the published version (or, failing that, the latest one) into the draft of a new form.
  // Field and choice keys are kept, so both forms classify answers the same way.
  async duplicate(formId: string, name: string, actorId: string): Promise<FormDetailView> {
    await this.findForm(formId)
    const source =
      (await this.prisma.questionnaireVersion.findFirst({
        where: { questionnaireId: formId, status: 'published' },
      })) ??
      (await this.prisma.questionnaireVersion.findFirst({
        where: { questionnaireId: formId },
        orderBy: { version: 'desc' },
      }))
    const copy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.questionnaire.create({
        data: { slug: await this.freeSlug(tx, name), name, usage: null },
      })
      const draft = await tx.questionnaireVersion.create({
        data: { questionnaireId: created.id, version: 1, status: 'draft' },
      })
      if (source) await copyVersionStructure(tx, source.id, draft.id)
      return created
    })
    await this.audit.record({
      actionType: 'form_created',
      actorId,
      metadata: {
        formId: copy.id,
        name,
        duplicatedFrom: { formId, versionId: source?.id ?? null },
      },
    })
    return this.get(copy.id)
  }

  // The form takes `usage` over from the form that had it, in one transaction: new dossiers are then
  // created with its published version, existing dossiers keep theirs (E03.09). There is no plain
  // unassignment: a usage always has a form, so it can only move to another published form.
  async assignUsage(formId: string, usage: FormUsage, actorId: string): Promise<FormDetailView> {
    const assigned = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockEditableForm(tx, formId)
      if (form.usage === usage) return null
      const published = await tx.questionnaireVersion.findFirst({
        where: { questionnaireId: formId, status: 'published' },
      })
      if (!published) throw FormErrors.notPublished()
      const current = await tx.questionnaire.findUnique({ where: { usage } })
      // Freed first: the unique index on `usage` is checked statement by statement.
      if (current) {
        await tx.questionnaire.update({ where: { id: current.id }, data: { usage: null } })
      }
      await tx.questionnaire.update({ where: { id: formId }, data: { usage } })
      return { published, replaced: current }
    })
    if (!assigned) return this.get(formId)
    const { published, replaced } = assigned
    await this.audit.record({
      actionType: 'form_updated',
      actorId,
      metadata: {
        formId,
        change: 'assigned',
        usage,
        versionId: published.id,
        replacedFormId: replaced?.id ?? null,
      },
    })
    return this.get(formId)
  }

  // An archived form is kept with all its versions (dossiers still read theirs) but can no longer be
  // edited. A form assigned to a usage serves new dossiers and cannot be archived.
  async archive(formId: string, actorId: string): Promise<FormDetailView> {
    const archived = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockForm(tx, formId)
      if (form.usage) throw FormErrors.formInUse()
      if (form.archivedAt) return false
      await tx.questionnaire.update({ where: { id: formId }, data: { archivedAt: new Date() } })
      return true
    })
    if (archived) {
      await this.audit.record({
        actionType: 'form_updated',
        actorId,
        metadata: { formId, change: 'archived' },
      })
    }
    return this.get(formId)
  }

  async restore(formId: string, actorId: string): Promise<FormDetailView> {
    const restored = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockForm(tx, formId)
      if (!form.archivedAt) return false
      await tx.questionnaire.update({ where: { id: formId }, data: { archivedAt: null } })
      return true
    })
    if (restored) {
      await this.audit.record({
        actionType: 'form_updated',
        actorId,
        metadata: { formId, change: 'restored' },
      })
    }
    return this.get(formId)
  }

  async findForm(formId: string): Promise<Questionnaire> {
    const form = await this.prisma.questionnaire.findUnique({ where: { id: formId } })
    if (!form) throw FormErrors.formNotFound()
    return form
  }

  async findEditableForm(formId: string): Promise<Questionnaire> {
    const form = await this.findForm(formId)
    if (form.archivedAt) throw FormErrors.formArchived()
    return form
  }

  // Every write to a form, its draft or its status starts with this lock, inside its transaction,
  // and reads the state only afterwards (code review R30): an edit can no longer interleave with a
  // publication, a discard or an archiving and reach a version that is not a draft any more.
  async lockForm(tx: Prisma.TransactionClient, formId: string): Promise<Questionnaire> {
    await tx.$queryRaw`SELECT 1 FROM "questionnaires" WHERE "id" = ${formId} FOR UPDATE`
    const form = await tx.questionnaire.findUnique({ where: { id: formId } })
    if (!form) throw FormErrors.formNotFound()
    return form
  }

  async lockEditableForm(tx: Prisma.TransactionClient, formId: string): Promise<Questionnaire> {
    const form = await this.lockForm(tx, formId)
    if (form.archivedAt) throw FormErrors.formArchived()
    return form
  }

  private async freeSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base = toKey(name).replace(/_/g, '-')
    const taken = new Set((await tx.questionnaire.findMany()).map((f) => f.slug))
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
    return slug
  }
}

function toSummary(form: Questionnaire, versions: QuestionnaireVersion[]): FormSummaryView {
  const published = versions.find((v) => v.status === 'published')
  const draft = versions.find((v) => v.status === 'draft')
  return {
    id: form.id,
    slug: form.slug,
    name: form.name,
    usage: form.usage,
    archivedAt: form.archivedAt,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    published:
      published && published.publishedAt
        ? { id: published.id, version: published.version, publishedAt: published.publishedAt }
        : null,
    draft: draft ? { id: draft.id, version: draft.version, updatedAt: draft.updatedAt } : null,
  }
}
