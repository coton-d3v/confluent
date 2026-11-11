import { Injectable } from '@nestjs/common'
import type { Prisma, Questionnaire, QuestionnaireVersion } from '@prisma/client'
import type { FormUsage } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FormDesignAccess, type FormDesigner } from './form-design-access'
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

// The usages each owner of forms may assign (E05.09): Confluent's forms serve the company profile, a
// workspace's form the candidatures it receives.
const USAGES_OF: Record<'confluent' | 'workspace', readonly FormUsage[]> = {
  confluent: ['dossier'],
  workspace: ['candidature'],
}

// Form-level operations of the builder: create, rename, duplicate, archive, restore. Structure
// editing lives in FormDraftsService. Reused as is by the MCP tools (E03.13 → E04); every read and
// write checks who acts with the single form design rule (E04.07), whatever the caller.
//
// E05.09: forms belong to Confluent (`workspaceId` null) or to one workspace. The designer says
// which (`FormDesigner.workspaceId`), the rule checks it, and every read and write reaches only the
// forms of that owner: another owner's form is « introuvable », exactly like a form that does not
// exist — a workspace never learns of another's forms, nor Confluent's builder of a workspace's.
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly design: FormDesignAccess,
  ) {}

  // Reading every form, drafts included, is part of designing them (E04.07): same rule as writes.
  async list(actor: FormDesigner): Promise<FormSummaryView[]> {
    const owner = await this.design.assert(actor)
    const forms = await this.prisma.questionnaire.findMany({
      where: { workspaceId: owner },
      orderBy: { createdAt: 'asc' },
    })
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: {
        questionnaireId: { in: forms.map((f) => f.id) },
        status: { in: ['draft', 'published'] },
      },
    })
    return forms.map((form) =>
      toSummary(
        form,
        versions.filter((v) => v.questionnaireId === form.id),
      ),
    )
  }

  async get(actor: FormDesigner, formId: string): Promise<FormDetailView> {
    const form = await this.findForm(formId, await this.design.assert(actor))
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: formId },
      orderBy: { version: 'desc' },
    })
    return { ...toSummary(form, versions), versions }
  }

  async summary(actor: FormDesigner, formId: string): Promise<FormSummaryView> {
    const form = await this.findForm(formId, await this.design.assert(actor))
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: formId, status: { in: ['draft', 'published'] } },
    })
    return toSummary(form, versions)
  }

  // A new form is unassigned (E03.09 assigns it to a usage) and starts with an empty draft.
  async create(actor: FormDesigner, name: string): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    const form = await this.prisma.$transaction(async (tx) => {
      const created = await tx.questionnaire.create({
        data: { slug: await this.freeSlug(tx, name, owner), name, usage: null, workspaceId: owner },
      })
      await tx.questionnaireVersion.create({
        data: { questionnaireId: created.id, version: 1, status: 'draft' },
      })
      return created
    })
    await this.audit.record({
      actionType: 'form_created',
      actorId: actor.id,
      metadata: { formId: form.id, name, workspaceId: owner },
    })
    return this.get(actor, form.id)
  }

  // The slug is the form's stable identifier: renaming keeps it.
  async rename(actor: FormDesigner, formId: string, name: string): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    const form = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEditableForm(tx, formId, owner)
      await tx.questionnaire.update({ where: { id: formId }, data: { name } })
      return locked
    })
    await this.audit.record({
      actionType: 'form_updated',
      actorId: actor.id,
      metadata: { formId, change: 'renamed', from: form.name, to: name },
    })
    return this.get(actor, formId)
  }

  // Copies the published version (or, failing that, the latest one) into the draft of a new form of
  // the same owner. Field and choice keys are kept, so both forms classify answers the same way.
  async duplicate(actor: FormDesigner, formId: string, name: string): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    await this.findForm(formId, owner)
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
        data: { slug: await this.freeSlug(tx, name, owner), name, usage: null, workspaceId: owner },
      })
      const draft = await tx.questionnaireVersion.create({
        data: { questionnaireId: created.id, version: 1, status: 'draft' },
      })
      if (source) await copyVersionStructure(tx, source.id, draft.id)
      return created
    })
    await this.audit.record({
      actionType: 'form_created',
      actorId: actor.id,
      metadata: {
        formId: copy.id,
        name,
        workspaceId: owner,
        duplicatedFrom: { formId, versionId: source?.id ?? null },
      },
    })
    return this.get(actor, copy.id)
  }

  // The form takes `usage` over from the form that had it, in one transaction: new dossiers are then
  // created with its published version, existing dossiers keep theirs (E03.09). There is no plain
  // unassignment: a usage always has a form, so it can only move to another published form. E05.09:
  // within the form's owner — a workspace's complementary form (`candidature`) replaces that
  // workspace's previous one; new candidatures to it answer its published version, existing ones
  // keep theirs.
  async assignUsage(
    actor: FormDesigner,
    formId: string,
    usage: FormUsage,
  ): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    if (!USAGES_OF[owner === null ? 'confluent' : 'workspace'].includes(usage)) {
      throw FormErrors.usageNotAllowed(owner !== null)
    }
    const assigned = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockEditableForm(tx, formId, owner)
      if (form.usage === usage) return null
      const published = await tx.questionnaireVersion.findFirst({
        where: { questionnaireId: formId, status: 'published' },
      })
      if (!published) throw FormErrors.notPublished()
      const current = await tx.questionnaire.findFirst({ where: { usage, workspaceId: owner } })
      // Freed first: the unique index on `usage` is checked statement by statement.
      if (current) {
        await tx.questionnaire.update({ where: { id: current.id }, data: { usage: null } })
      }
      await tx.questionnaire.update({ where: { id: formId }, data: { usage } })
      return { published, replaced: current }
    })
    if (!assigned) return this.get(actor, formId)
    const { published, replaced } = assigned
    await this.audit.record({
      actionType: 'form_updated',
      actorId: actor.id,
      metadata: {
        formId,
        change: 'assigned',
        usage,
        workspaceId: owner,
        versionId: published.id,
        replacedFormId: replaced?.id ?? null,
      },
    })
    return this.get(actor, formId)
  }

  // An archived form is kept with all its versions (dossiers still read theirs) but can no longer be
  // edited. A form assigned to a usage serves new dossiers and cannot be archived.
  async archive(actor: FormDesigner, formId: string): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    const archived = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockForm(tx, formId, owner)
      if (form.usage) throw FormErrors.formInUse()
      if (form.archivedAt) return false
      await tx.questionnaire.update({ where: { id: formId }, data: { archivedAt: new Date() } })
      return true
    })
    if (archived) {
      await this.audit.record({
        actionType: 'form_updated',
        actorId: actor.id,
        metadata: { formId, change: 'archived' },
      })
    }
    return this.get(actor, formId)
  }

  async restore(actor: FormDesigner, formId: string): Promise<FormDetailView> {
    const owner = await this.design.assert(actor)
    const restored = await this.prisma.$transaction(async (tx) => {
      const form = await this.lockForm(tx, formId, owner)
      if (!form.archivedAt) return false
      await tx.questionnaire.update({ where: { id: formId }, data: { archivedAt: null } })
      return true
    })
    if (restored) {
      await this.audit.record({
        actionType: 'form_updated',
        actorId: actor.id,
        metadata: { formId, change: 'restored' },
      })
    }
    return this.get(actor, formId)
  }

  // `owner`: the workspace whose forms the designer reaches (null: Confluent's), as returned by
  // FormDesignAccess. A form of another owner is not found.
  async findForm(formId: string, owner: string | null): Promise<Questionnaire> {
    const form = await this.prisma.questionnaire.findUnique({ where: { id: formId } })
    if (!form || form.workspaceId !== owner) throw FormErrors.formNotFound()
    return form
  }

  // Every write to a form, its draft or its status starts with this lock, inside its transaction,
  // and reads the state only afterwards (code review R30): an edit can no longer interleave with a
  // publication, a discard or an archiving and reach a version that is not a draft any more.
  async lockForm(
    tx: Prisma.TransactionClient,
    formId: string,
    owner: string | null,
  ): Promise<Questionnaire> {
    await tx.$queryRaw`SELECT 1 FROM "questionnaires" WHERE "id" = ${formId} FOR UPDATE`
    const form = await tx.questionnaire.findUnique({ where: { id: formId } })
    if (!form || form.workspaceId !== owner) throw FormErrors.formNotFound()
    return form
  }

  async lockEditableForm(
    tx: Prisma.TransactionClient,
    formId: string,
    owner: string | null,
  ): Promise<Questionnaire> {
    const form = await this.lockForm(tx, formId, owner)
    if (form.archivedAt) throw FormErrors.formArchived()
    return form
  }

  // Slugs are unique across Confluent. A workspace's are prefixed with the workspace's own slug and
  // « -- » (which neither slug contains): two workspaces never compete for a slug, so a slug never
  // tells one workspace that another has a form of that name.
  private async freeSlug(
    tx: Prisma.TransactionClient,
    name: string,
    owner: string | null,
  ): Promise<string> {
    const workspace = owner ? await tx.workspace.findUnique({ where: { id: owner } }) : null
    const base = (workspace ? `${workspace.slug}--` : '') + toKey(name).replace(/_/g, '-')
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
