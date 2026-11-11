import { Injectable } from '@nestjs/common'
import {
  Prisma,
  type QuestionnaireField,
  type QuestionnaireSection,
  type QuestionnaireVersion,
} from '@prisma/client'
import {
  constraintsProblem,
  fieldTypeAllowedInWorkspaceForms,
  type CreateDraftFieldInput,
  type FieldConstraints,
  type FieldType,
  CreateDraftSectionInput,
  type DraftProblem,
  type UpdateDraftFieldInput,
  type UpdateDraftSectionInput,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { type ActionOrigin, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { validateDraft } from './draft-validation'
import { FormDesignAccess, type FormDesigner } from './form-design-access'
import { FormErrors } from './form-errors'
import { FormsService, type FormSummaryView } from './forms.service'
import { copyVersionStructure, toChoices, toKey, uniqueKey } from './questionnaire-structure'
import { QuestionnairesService, type VersionStructure } from './questionnaires.service'

export interface FormVersionView extends VersionStructure {
  form: FormSummaryView
  problems: DraftProblem[]
}

// The draft of a form being edited, loaded inside the edit transaction.
interface DraftContext {
  // The workspace the form belongs to, null for Confluent's (E05.09).
  owner: string | null
  draft: QuestionnaireVersion
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

// Draft lifecycle (create, discard, publish) and structure editing (E03.02, E03.03, E03.08).
// Every structure edit targets the form's single draft: a published or archived version, which
// dossiers read, can never be modified. Reused as is by the MCP tools (E03.13 → E04); every read and
// write checks who acts with the single form design rule (E04.07), whatever the caller.
@Injectable()
export class FormDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly questionnaires: QuestionnairesService,
    private readonly audit: AuditService,
    private readonly design: FormDesignAccess,
  ) {}

  async getVersion(
    actor: FormDesigner,
    formId: string,
    versionId: string,
  ): Promise<FormVersionView> {
    await this.forms.findForm(formId, await this.design.assert(actor))
    const structure = await this.questionnaires.getVersion(versionId)
    if (!structure || structure.version.questionnaireId !== formId) {
      throw FormErrors.versionNotFound()
    }
    const problems =
      structure.version.status === 'draft'
        ? validateDraft(structure.sections, structure.fields)
        : []
    return { form: await this.forms.summary(actor, formId), ...structure, problems }
  }

  async getDraft(actor: FormDesigner, formId: string): Promise<FormVersionView> {
    await this.forms.findForm(formId, await this.design.assert(actor))
    const draft = await this.findDraft(this.prisma, formId)
    return this.getVersion(actor, formId, draft.id)
  }

  // Starts from a copy of the published version (same keys), or empty for a never-published form.
  async createDraft(actor: FormDesigner, formId: string): Promise<FormVersionView> {
    const owner = await this.design.assert(actor)
    let created: { draft: QuestionnaireVersion; from: QuestionnaireVersion | null }
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.forms.lockEditableForm(tx, formId, owner)
        const existing = await tx.questionnaireVersion.findFirst({
          where: { questionnaireId: formId, status: 'draft' },
        })
        if (existing) throw FormErrors.draftExists()
        const [latest, published] = await Promise.all([
          tx.questionnaireVersion.findFirst({
            where: { questionnaireId: formId },
            orderBy: { version: 'desc' },
          }),
          tx.questionnaireVersion.findFirst({
            where: { questionnaireId: formId, status: 'published' },
          }),
        ])
        const draft = await tx.questionnaireVersion.create({
          data: { questionnaireId: formId, version: (latest?.version ?? 0) + 1, status: 'draft' },
        })
        if (published) await copyVersionStructure(tx, published.id, draft.id)
        return { draft, from: published }
      })
    } catch (err) {
      // Two concurrent requests: the partial unique index lets only one draft through.
      if (isUniqueViolation(err)) throw FormErrors.draftExists()
      throw err
    }
    await this.audit.record({
      actionType: 'form_draft_created',
      actorId: actor.id,
      metadata: {
        formId,
        versionId: created.draft.id,
        version: created.draft.version,
        fromVersionId: created.from?.id ?? null,
      },
    })
    return this.getVersion(actor, formId, created.draft.id)
  }

  async discardDraft(actor: FormDesigner, formId: string, revision?: string): Promise<void> {
    const owner = await this.design.assert(actor)
    const draft = await this.prisma.$transaction(async (tx) => {
      await this.forms.lockEditableForm(tx, formId, owner)
      const found = await this.findDraft(tx, formId)
      assertRevision(found, revision)
      await tx.questionnaireField.deleteMany({ where: { versionId: found.id } })
      await tx.questionnaireSection.deleteMany({ where: { versionId: found.id } })
      await tx.questionnaireVersion.deleteMany({ where: { id: found.id } })
      return found
    })
    await this.audit.record({
      actionType: 'form_draft_discarded',
      actorId: actor.id,
      metadata: { formId, versionId: draft.id, version: draft.version },
    })
  }

  // The draft becomes the published version and the previous one is archived, in one transaction.
  // Dossiers keep the version they were created with (E03.08). Same publication from the site's
  // builder or from an AI application on the administrator's explicit instruction (E04.08), which
  // `origin` records in the journal.
  async publishDraft(
    actor: FormDesigner,
    formId: string,
    revision: string | undefined,
    origin: ActionOrigin,
  ): Promise<FormVersionView> {
    const owner = await this.design.assert(actor)
    const { draft, previous, fieldCount } = await this.prisma.$transaction(async (tx) => {
      await this.forms.lockEditableForm(tx, formId, owner)
      const ctx = await this.loadDraft(tx, formId, owner)
      assertRevision(ctx.draft, revision)
      const problems = validateDraft(ctx.sections, ctx.fields)
      if (problems.length > 0) throw FormErrors.draftInvalid(problems)
      const current = await tx.questionnaireVersion.findFirst({
        where: { questionnaireId: formId, status: 'published' },
      })
      if (current) {
        await tx.questionnaireVersion.update({
          where: { id: current.id },
          data: { status: 'archived' },
        })
      }
      await tx.questionnaireVersion.update({
        where: { id: ctx.draft.id },
        data: { status: 'published', publishedAt: new Date() },
      })
      return { draft: ctx.draft, previous: current, fieldCount: ctx.fields.length }
    })
    await this.audit.record({
      actionType: 'questionnaire_version_published',
      actorId: actor.id,
      metadata: {
        formId,
        versionId: draft.id,
        version: draft.version,
        fieldCount,
        archivedVersionId: previous?.id ?? null,
        workspaceId: owner,
        ...originMetadata(origin),
      },
    })
    return this.getVersion(actor, formId, draft.id)
  }

  addSection(
    actor: FormDesigner,
    formId: string,
    input: CreateDraftSectionInput,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { draft, sections }) => {
      const key = this.newKey(input.key, input.title, sections)
      await tx.questionnaireSection.create({
        data: { versionId: draft.id, key, title: input.title, orderIndex: nextIndex(sections) },
      })
    })
  }

  updateSection(
    actor: FormDesigner,
    formId: string,
    sectionId: string,
    input: UpdateDraftSectionInput,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { sections }) => {
      const section = sections.find((s) => s.id === sectionId)
      if (!section) throw FormErrors.sectionNotFound()
      if (input.key && input.key !== section.key && sections.some((s) => s.key === input.key)) {
        throw FormErrors.keyTaken(input.key)
      }
      await tx.questionnaireSection.update({
        where: { id: sectionId },
        data: { title: input.title, key: input.key },
      })
    })
  }

  // Removes the section and its fields.
  removeSection(
    actor: FormDesigner,
    formId: string,
    sectionId: string,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { sections }) => {
      if (!sections.some((s) => s.id === sectionId)) throw FormErrors.sectionNotFound()
      await tx.questionnaireField.deleteMany({ where: { sectionId } })
      await tx.questionnaireSection.deleteMany({ where: { id: sectionId } })
      await renumber(
        tx.questionnaireSection,
        sections.filter((s) => s.id !== sectionId),
      )
    })
  }

  reorderSections(
    actor: FormDesigner,
    formId: string,
    ids: string[],
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { sections }) => {
      await renumber(tx.questionnaireSection, inGivenOrder(sections, ids))
    })
  }

  // A new field without explicit level is readable at the most restrictive share level (E03.07).
  addField(
    actor: FormDesigner,
    formId: string,
    input: CreateDraftFieldInput,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(
      actor,
      formId,
      revision,
      async (tx, { owner, draft, sections, fields }) => {
        if (!sections.some((s) => s.id === input.sectionId)) throw FormErrors.sectionNotFound()
        assertFieldTypeAllowed(owner, input.fieldType)
        if (input.choices && input.fieldType !== 'select') throw FormErrors.choicesNotAllowed()
        const constraints = checkedConstraints(input.fieldType, input.constraints ?? {})
        await tx.questionnaireField.create({
          data: {
            versionId: draft.id,
            sectionId: input.sectionId,
            key: this.newKey(input.key, input.label, fields),
            label: input.label,
            helpText: input.helpText ?? null,
            fieldType: input.fieldType,
            required: input.required,
            choices: asJson(toChoices(input.choices ?? [])),
            constraints: asJson(constraints),
            minAccessLevel: input.minAccessLevel ?? 'complet',
            orderIndex: nextIndex(fields.filter((f) => f.sectionId === input.sectionId)),
          },
        })
      },
    )
  }

  updateField(
    actor: FormDesigner,
    formId: string,
    fieldId: string,
    input: UpdateDraftFieldInput,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { owner, sections, fields }) => {
      const field = fields.find((f) => f.id === fieldId)
      if (!field) throw FormErrors.fieldNotFound()
      const fieldType = input.fieldType ?? field.fieldType
      assertFieldTypeAllowed(owner, fieldType)
      if (input.choices && fieldType !== 'select') throw FormErrors.choicesNotAllowed()
      if (input.key && input.key !== field.key && fields.some((f) => f.key === input.key)) {
        throw FormErrors.keyTaken(input.key)
      }
      const data: Prisma.QuestionnaireFieldUncheckedUpdateInput = {
        label: input.label,
        key: input.key,
        helpText: input.helpText,
        fieldType: input.fieldType,
        required: input.required,
        minAccessLevel: input.minAccessLevel,
      }
      if (fieldType !== 'select') data.choices = asJson([])
      else if (input.choices) data.choices = asJson(toChoices(input.choices))
      // Limits of another type are meaningless: a type change without new limits clears them.
      if (input.constraints)
        data.constraints = asJson(checkedConstraints(fieldType, input.constraints))
      else if (fieldType !== field.fieldType) data.constraints = asJson({})

      const moving = input.sectionId !== undefined && input.sectionId !== field.sectionId
      if (moving) {
        if (!sections.some((s) => s.id === input.sectionId)) throw FormErrors.sectionNotFound()
        data.sectionId = input.sectionId
        data.orderIndex = nextIndex(fields.filter((f) => f.sectionId === input.sectionId))
      }
      await tx.questionnaireField.update({ where: { id: fieldId }, data })
      if (moving) {
        await renumber(
          tx.questionnaireField,
          sectionFields(fields, field.sectionId).filter((f) => f.id !== fieldId),
        )
      }
    })
  }

  removeField(
    actor: FormDesigner,
    formId: string,
    fieldId: string,
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { fields }) => {
      const field = fields.find((f) => f.id === fieldId)
      if (!field) throw FormErrors.fieldNotFound()
      await tx.questionnaireField.deleteMany({ where: { id: fieldId } })
      await renumber(
        tx.questionnaireField,
        sectionFields(fields, field.sectionId).filter((f) => f.id !== fieldId),
      )
    })
  }

  reorderFields(
    actor: FormDesigner,
    formId: string,
    sectionId: string,
    ids: string[],
    revision?: string,
  ): Promise<FormVersionView> {
    return this.editDraft(actor, formId, revision, async (tx, { sections, fields }) => {
      if (!sections.some((s) => s.id === sectionId)) throw FormErrors.sectionNotFound()
      await renumber(tx.questionnaireField, inGivenOrder(sectionFields(fields, sectionId), ids))
    })
  }

  // Runs one structure edit on the form's draft, in a transaction that holds the form lock, then
  // returns the new draft. With `revision`, the edit is refused if the draft changed meanwhile.
  private async editDraft(
    actor: FormDesigner,
    formId: string,
    revision: string | undefined,
    edit: (tx: Prisma.TransactionClient, ctx: DraftContext) => Promise<void>,
  ): Promise<FormVersionView> {
    const owner = await this.design.assert(actor)
    const draftId = await this.prisma.$transaction(async (tx) => {
      await this.forms.lockEditableForm(tx, formId, owner)
      const ctx = await this.loadDraft(tx, formId, owner)
      assertRevision(ctx.draft, revision)
      await edit(tx, ctx)
      await tx.questionnaireVersion.update({
        where: { id: ctx.draft.id },
        data: { updatedAt: new Date() },
      })
      return ctx.draft.id
    })
    return this.getVersion(actor, formId, draftId)
  }

  private async loadDraft(
    tx: Prisma.TransactionClient,
    formId: string,
    owner: string | null,
  ): Promise<DraftContext> {
    const draft = await this.findDraft(tx, formId)
    const [sections, fields] = await Promise.all([
      tx.questionnaireSection.findMany({
        where: { versionId: draft.id },
        orderBy: { orderIndex: 'asc' },
      }),
      tx.questionnaireField.findMany({
        where: { versionId: draft.id },
        orderBy: { orderIndex: 'asc' },
      }),
    ])
    return { owner, draft, sections, fields }
  }

  private async findDraft(
    db: Prisma.TransactionClient,
    formId: string,
  ): Promise<QuestionnaireVersion> {
    const draft = await db.questionnaireVersion.findFirst({
      where: { questionnaireId: formId, status: 'draft' },
    })
    if (!draft) throw FormErrors.draftNotFound()
    return draft
  }

  // An explicit key must be free in the draft; otherwise one is derived from the label.
  private newKey(
    explicit: string | undefined,
    label: string,
    siblings: ReadonlyArray<{ key: string }>,
  ): string {
    const taken = new Set(siblings.map((s) => s.key))
    if (explicit) {
      if (taken.has(explicit)) throw FormErrors.keyTaken(explicit)
      return explicit
    }
    return uniqueKey(toKey(label), taken)
  }
}

function assertFieldTypeAllowed(owner: string | null, fieldType: FieldType): void {
  if (owner !== null && !fieldTypeAllowedInWorkspaceForms(fieldType)) {
    throw FormErrors.fieldTypeNotAllowed()
  }
}

function checkedConstraints(fieldType: FieldType, constraints: FieldConstraints): FieldConstraints {
  const problem = constraintsProblem(fieldType, constraints)
  if (problem) throw FormErrors.invalidConstraints(problem)
  return constraints
}

const nextIndex = (rows: ReadonlyArray<{ orderIndex: number }>) =>
  rows.reduce((max, r) => Math.max(max, r.orderIndex + 1), 0)

const sectionFields = (fields: QuestionnaireField[], sectionId: string) =>
  fields.filter((f) => f.sectionId === sectionId).sort((a, b) => a.orderIndex - b.orderIndex)

// `ids` must list each row exactly once.
function inGivenOrder<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  if (ids.length !== rows.length || !ids.every((id) => byId.has(id))) {
    throw FormErrors.invalidOrder()
  }
  return ids.map((id) => byId.get(id)!)
}

// Positions 0..n-1 in the given order; only rows whose position changes are written.
async function renumber(
  delegate: { update: (args: { where: { id: string }; data: { orderIndex: number } }) => unknown },
  rows: ReadonlyArray<{ id: string; orderIndex: number }>,
): Promise<void> {
  for (const [index, row] of rows.entries()) {
    if (row.orderIndex !== index) {
      await delegate.update({ where: { id: row.id }, data: { orderIndex: index } })
    }
  }
}

// Optimistic check for several administrators: `revision` is the draft's `updatedAt` the client saw.
function assertRevision(draft: QuestionnaireVersion, revision: string | undefined): void {
  if (revision !== undefined && draft.updatedAt.toISOString() !== revision) {
    throw FormErrors.draftStale()
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
