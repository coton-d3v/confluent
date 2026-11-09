import { Injectable, NotFoundException } from '@nestjs/common'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { missingRequiredAnswers, type AccessLevel } from '@confluent/shared'
import type { Dossier, QuestionnaireField, QuestionnaireVersion } from '@prisma/client'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { AnswersService } from '../answers/answers.service'
import { InvalidAnswersException } from '../answers/invalid-answers.exception'
import { AuditService } from '../audit/audit.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { attachedFieldIds } from '../documents/attached-fields'
import { DocumentsService, type DocumentGroup } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { fieldVisibleAt } from '../dossiers/financeur-access'
import { OAUTH_SCOPES, expandScopes } from '../oauth/oauth.constants'
import { FormDraftsService } from '../questionnaires/form-drafts.service'
import { FormsService } from '../questionnaires/forms.service'
import { DOSSIER_FORM, QuestionnairesService } from '../questionnaires/questionnaires.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import {
  describeCompletion,
  describeField,
  groupBySection,
  isFieldAnswered,
} from './form-description'

// Who is calling: always derived from the OAuth access token, never from tool arguments (E01.06).
export interface McpCaller {
  user: AuthenticatedUser
  scopes: string[]
  clientId: string
  clientName: string
  grantId: string
}

// Scope each tool needs; also used by the HTTP layer to answer 403 insufficient_scope up front.
export const TOOL_SCOPES: Record<string, string> = {
  whoami: OAUTH_SCOPES.read,
  list_dossiers: OAUTH_SCOPES.read,
  get_dossier: OAUTH_SCOPES.read,
  get_form: OAUTH_SCOPES.read,
  list_forms: OAUTH_SCOPES.read,
  update_answers: OAUTH_SCOPES.write,
}

// The dossier a tool call is about, once the caller's access to it is established.
interface ToolTrace {
  dossierId: string | null
}

class ToolError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const dossierRef = z
  .string()
  .min(1)
  .describe('Identifiant (UUID) ou slug du dossier, tel que renvoyé par list_dossiers.')

@Injectable()
export class McpToolsFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dossiers: DossiersService,
    private readonly answers: AnswersService,
    private readonly questionnaires: QuestionnairesService,
    private readonly forms: FormsService,
    private readonly formDrafts: FormDraftsService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  // One server per HTTP request (stateless transport), bound to the caller.
  createServer(caller: McpCaller): McpServer {
    const server = new McpServer(
      { name: 'confluent', title: 'Confluent', version: process.env.APP_VERSION ?? 'dev' },
      {
        instructions:
          'Confluent héberge les dossiers de financement d’entreprises innovantes. Commencez par ' +
          'list_dossiers, puis get_dossier pour lire les questions (fieldId, type, format attendu, ' +
          'contraintes, choix possibles, réponse actuelle), vos permissions et l’état de complétion. ' +
          'get_form décrit un formulaire sans dossier (celui des nouveaux dossiers par défaut). ' +
          'update_answers enregistre des réponses ; n’inventez jamais une réponse : demandez-la à ' +
          'l’utilisateur.',
      },
    )
    const run = this.runner(caller)

    server.registerTool(
      'whoami',
      {
        title: 'Mon compte',
        description:
          'Compte Confluent connecté, son rôle et les permissions accordées à cette application.',
        annotations: { readOnlyHint: true },
      },
      () =>
        run('whoami', null, async () => {
          const user = await this.prisma.user.findUnique({ where: { id: caller.user.id } })
          return {
            id: caller.user.id,
            email: caller.user.email,
            role: caller.user.role,
            firstName: user?.firstName ?? null,
            lastName: user?.lastName ?? null,
            grantedScopes: [...expandScopes(caller.scopes)],
            application: caller.clientName,
          }
        }),
    )

    server.registerTool(
      'list_dossiers',
      {
        title: 'Lister mes dossiers',
        description:
          'Dossiers accessibles : ceux dont vous êtes propriétaire, et pour un financeur ceux qui ' +
          'vous ont été partagés (contenu limité au niveau d’accès du partage).',
        annotations: { readOnlyHint: true },
      },
      () =>
        run('list_dossiers', null, async () => {
          const rows = await this.dossiers.listForUser(caller.user)
          return {
            dossiers: rows.map((d) => ({
              id: d.id,
              slug: d.slug,
              name: d.name,
              relation: d.userId === caller.user.id ? 'proprietaire' : 'partage',
              submittedAt: d.submittedAt,
              sector: d.sector,
              maturityStage: d.maturityStage,
            })),
          }
        }),
    )

    server.registerTool(
      'get_dossier',
      {
        title: 'Lire un dossier',
        description:
          'Questions du dossier (version de formulaire du dossier), groupées par section, avec ' +
          'pour chacune fieldId, type, format attendu, contraintes (en clair et en valeurs), choix ' +
          'possibles (clé et libellé), obligatoire, si elle est remplie, et réponse actuelle (clé du ' +
          'choix pour une liste, avec son libellé) ; pour un champ « file », les documents déposés ' +
          '(nom, version, disponibilité) au lieu d’une réponse. Indique aussi le formulaire et sa ' +
          'version, vos permissions (niveau d’accès, modification possible ou non et pourquoi) et ' +
          'l’état de complétion (global et par section), avec les champs obligatoires manquants. ' +
          'Utilisez les fieldId pour update_answers.',
        inputSchema: { dossier: dossierRef },
        annotations: { readOnlyHint: true },
      },
      ({ dossier }) =>
        run('get_dossier', dossier, async (trace) => {
          const { row, accessLevel } = await this.resolve(caller.user, dossier, trace)
          return this.describeDossier(row, accessLevel, caller)
        }),
    )

    server.registerTool(
      'get_form',
      {
        title: 'Lire un formulaire',
        description:
          'Définition d’un formulaire, sans réponses : sections et questions avec fieldId, clé, ' +
          'type, format attendu, contraintes, choix, obligatoire et qui peut lire la réponse via un ' +
          'partage. Par défaut, la version publiée du formulaire des nouveaux dossiers. Porteurs de ' +
          'projet : ce formulaire uniquement. Administrateurs : tout formulaire et toute version, ' +
          'brouillon compris (avec les problèmes qui empêchent de le publier).',
        inputSchema: {
          form: z
            .string()
            .min(1)
            .optional()
            .describe(
              'UUID ou slug du formulaire (administrateurs) ; par défaut celui des nouveaux dossiers.',
            ),
          version: z
            .union([z.number().int().positive(), z.literal('brouillon')])
            .optional()
            .describe(
              'Numéro de version, ou "brouillon" (administrateurs) ; par défaut la version publiée.',
            ),
        },
        annotations: { readOnlyHint: true },
      },
      ({ form, version }) =>
        run('get_form', form ?? null, async () => this.describeForm(caller, form, version)),
    )

    server.registerTool(
      'list_forms',
      {
        title: 'Lister les formulaires',
        description:
          'Administrateurs : tous les formulaires, leur usage (formulaire des nouveaux dossiers ou ' +
          'non affecté), s’ils sont archivés, et leurs versions (brouillon, publiée, archivées).',
        annotations: { readOnlyHint: true },
      },
      () =>
        run('list_forms', null, async () => {
          requireAdmin(caller)
          const forms = await this.forms.list()
          const details = await Promise.all(forms.map((f) => this.forms.get(f.id)))
          return {
            forms: details.map((f) => ({
              id: f.id,
              slug: f.slug,
              name: f.name,
              usage: f.usage,
              archived: f.archivedAt !== null,
              versions: f.versions.map((v) => ({
                version: v.version,
                status: v.status,
                publishedAt: v.publishedAt,
              })),
            })),
          }
        }),
    )

    server.registerTool(
      'update_answers',
      {
        title: 'Enregistrer des réponses',
        description:
          'Enregistre une ou plusieurs réponses dans un dossier dont vous êtes propriétaire. ' +
          'Chaque réponse cible un fieldId de get_dossier. Valeurs : texte libre ; nombre ("1200" ou ' +
          '"3,5") ; date "AAAA-MM-JJ" ; case à cocher "true"/"false" ; liste : la clé d’un des ' +
          'choix (son libellé exact est aussi accepté). Une chaîne vide efface la réponse. Un champ ' +
          '« file » attend un document déposé dans le dossier, pas une valeur. Rien n’est enregistré si une valeur est invalide.',
        inputSchema: {
          dossier: dossierRef,
          answers: z
            .array(
              z.object({
                fieldId: z.string().describe('fieldId renvoyé par get_dossier'),
                value: z.string().max(10_000),
              }),
            )
            .min(1)
            .max(200),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      ({ dossier, answers }) =>
        run('update_answers', dossier, async (trace) => {
          if (!expandScopes(caller.scopes).has(OAUTH_SCOPES.write)) {
            throw new ToolError('Permission « dossiers:write » non accordée à cette application.')
          }
          const { row } = await this.resolve(caller.user, dossier, trace)
          if (row.userId !== caller.user.id) {
            throw new ToolError('Seul le propriétaire du dossier peut modifier ses réponses.')
          }
          try {
            await this.answers.saveForDossier(row, answers)
          } catch (err) {
            if (!(err instanceof InvalidAnswersException)) throw err
            throw new ToolError(
              'Aucune réponse enregistrée. Corrigez :\n' +
                err.errors.map((e) => `- ${e.label ?? e.fieldId} : ${e.message}`).join('\n'),
            )
          }
          // Described as it is after the write (answers and derived classification, R18).
          const updated = await this.prisma.dossier.findUnique({ where: { id: row.id } })
          if (!updated) throw new NotFoundException()
          const after = await this.describeDossier(updated, 'complet', caller)
          return {
            dossier: { id: row.id, slug: row.slug },
            saved: answers.length,
            missingRequired: after.missingRequired,
            message: 'Réponses enregistrées ; elles sont visibles dans Confluent.',
          }
        }),
    )

    return server
  }

  private runner(caller: McpCaller) {
    return async (
      tool: string,
      target: string | null,
      fn: (trace: ToolTrace) => Promise<Record<string, unknown>>,
    ): Promise<CallToolResult> => {
      let result: 'ok' | 'error' = 'ok'
      const trace: ToolTrace = { dossierId: null }
      try {
        const data = await fn(trace)
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        }
      } catch (err) {
        result = 'error'
        const message =
          err instanceof ToolError
            ? err.message
            : err instanceof NotFoundException
              ? 'Dossier introuvable, ou vous n’y avez pas accès. Utilisez list_dossiers.'
              : 'Erreur inattendue côté Confluent.'
        return { isError: true, content: [{ type: 'text', text: message }] }
      } finally {
        // E01.07: who, which client, which tool, which target, outcome.
        await this.audit.record({
          actionType: 'mcp_tool_called',
          actorId: caller.user.id,
          dossierId: trace.dossierId,
          metadata: {
            tool,
            target,
            result,
            clientId: caller.clientId,
            clientName: caller.clientName,
            grantId: caller.grantId,
          },
        })
      }
    }
  }

  // Once access is granted, the dossier is noted in `trace`: the call is journaled with it even if
  // it fails afterwards (code review R20). A dossier the caller may not access is never noted.
  private async resolve(user: AuthenticatedUser, ref: string, trace: ToolTrace) {
    let id = ref
    if (!UUID.test(ref)) {
      const bySlug = await this.prisma.dossier.findUnique({
        where: { slug: ref },
        select: { id: true },
      })
      if (!bySlug) throw new NotFoundException()
      id = bySlug.id
    }
    const { dossier, accessLevel } = await this.dossiers.resolveReadAccess(id, user)
    trace.dossierId = dossier.id
    return { row: dossier, accessLevel }
  }

  private async describeDossier(dossier: Dossier, accessLevel: AccessLevel, caller: McpCaller) {
    const structure = await this.questionnaires.getVersion(dossier.questionnaireVersionId)
    const allFields = structure?.fields ?? []
    const fields = allFields.filter((f) => fieldVisibleAt(f, accessLevel))
    const visible = new Set(fields.map((f) => f.id))
    const [answerRows, documents, attached, form] = await Promise.all([
      this.answers.listForDossier(dossier.id),
      this.documents.listForDossier(dossier.id, accessLevel),
      attachedFieldIds(this.prisma, dossier.id),
      structure ? this.describeFormOf(structure.version) : null,
    ])
    const answers = new Map(
      answerRows.filter((a) => visible.has(a.fieldId)).map((a) => [a.fieldId, a.value]),
    )
    const filesByField = documentsByField(documents)
    const isOwner = dossier.userId === caller.user.id
    const canEdit = isOwner && expandScopes(caller.scopes).has(OAUTH_SCOPES.write)
    const sections = groupBySection(structure?.sections ?? [], fields, (f) => ({
      ...describeField(f, { withReadLevel: isOwner }),
      answered: isFieldAnswered(f, answers, attached),
      ...(f.fieldType === 'file'
        ? { documents: filesByField.get(f.id) ?? [] }
        : describeAnswer(f, answers.get(f.id) ?? null)),
    }))
    const projected = await this.dossiers.projectForLevel(dossier, accessLevel)
    return {
      dossier: {
        id: dossier.id,
        slug: dossier.slug,
        name: dossier.name,
        relation: isOwner ? 'proprietaire' : 'partage',
        accessLevel,
        submittedAt: dossier.submittedAt,
        classification: {
          sector: projected.sector,
          maturityStage: projected.maturityStage,
          ancrageCvl: projected.ancrageCvl,
          tagTechnologique: projected.tagTechnologique,
        },
      },
      // The form version the dossier was created with: its answers always follow it (E03.08).
      form,
      permissions: {
        accessLevel,
        // Questions this share level does not show: the dossier is only partly visible.
        hiddenFields: allFields.length - fields.length,
        canEditAnswers: canEdit,
        ...(canEdit
          ? {}
          : {
              whyReadOnly: isOwner
                ? 'Permission « dossiers:write » non accordée à cette application.'
                : 'Dossier partagé avec vous : lecture seule, limitée au niveau de votre partage.',
            }),
        canUploadDocuments: false,
        canSubmit: false,
        ...(isOwner
          ? {
              inSiteOnly:
                'Le dépôt de documents et la soumission du dossier se font pour l’instant dans le site Confluent.',
            }
          : {}),
      },
      completion: describeCompletion(
        structure?.sections ?? [],
        fields,
        answers,
        attached,
        dossier.submittedAt,
      ),
      canEdit,
      sections,
      // Same rule as the submission check (shared): an attachment field needs a document.
      missingRequired: missingRequiredAnswers(fields, Object.fromEntries(answers), attached).map(
        (f) => ({
          fieldId: f.id,
          label: f.label,
        }),
      ),
    }
  }

  // E04.01: the definition of a form version. Project owners read the published form of new dossiers
  // (what they will be asked); administrators read any form and version, draft included.
  private async describeForm(
    caller: McpCaller,
    formRef: string | undefined,
    versionRef: number | 'brouillon' | undefined,
  ) {
    const isAdmin = caller.user.role === 'admin'
    if (!isAdmin && caller.user.role !== 'entrepreneur') {
      throw new ToolError(
        'Les définitions de formulaires sont réservées aux porteurs de projet et aux administrateurs.',
      )
    }
    const form = await this.prisma.questionnaire.findFirst({
      where: formRef
        ? UUID.test(formRef)
          ? { id: formRef }
          : { slug: formRef }
        : { usage: DOSSIER_FORM.usage },
    })
    const readable = form && (isAdmin || (form.usage === DOSSIER_FORM.usage && !form.archivedAt))
    if (!readable) {
      throw new ToolError(
        isAdmin
          ? 'Formulaire introuvable. Utilisez list_forms.'
          : 'Formulaire introuvable : seul le formulaire des nouveaux dossiers est lisible.',
      )
    }
    // Whether a draft exists is the administrators' business: refused before looking.
    if (!isAdmin && versionRef === 'brouillon') {
      throw new ToolError('Seule la version publiée est lisible.')
    }
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: form.id },
      orderBy: { version: 'desc' },
    })
    const published = versions.find((v) => v.status === 'published')
    const draft = versions.find((v) => v.status === 'draft')
    const target =
      versionRef === 'brouillon'
        ? draft
        : versionRef !== undefined
          ? versions.find((v) => v.version === versionRef)
          : (published ?? (isAdmin ? draft : undefined))
    if (!target) {
      throw new ToolError(
        versionRef === 'brouillon'
          ? 'Ce formulaire n’a pas de brouillon en cours.'
          : 'Version introuvable pour ce formulaire.',
      )
    }
    if (!isAdmin && target.status !== 'published') {
      throw new ToolError('Seule la version publiée est lisible.')
    }
    const view = await this.formDrafts.getVersion(form.id, target.id)
    const labels = new Map(view.fields.map((f) => [f.id, f.label]))
    return {
      form: {
        id: form.id,
        slug: form.slug,
        name: form.name,
        usage: form.usage,
        archived: form.archivedAt !== null,
        publishedVersion: published?.version ?? null,
        draftVersion: isAdmin ? (draft?.version ?? null) : null,
      },
      version: {
        version: target.version,
        status: target.status,
        publishedAt: target.publishedAt,
        ...(target.status === 'draft'
          ? {
              note: 'Brouillon : modifiable, aucun dossier ne l’utilise tant qu’il n’est pas publié.',
            }
          : {}),
      },
      summary: {
        sections: view.sections.length,
        fields: view.fields.length,
        required: view.fields.filter((f) => f.required).length,
      },
      sections: groupBySection(view.sections, view.fields, (f) =>
        describeField(f, { withReadLevel: true }),
      ),
      // What prevents publishing a draft (same checks as the builder).
      ...(target.status === 'draft'
        ? {
            problems: view.problems.map((p) => ({
              message: p.message,
              ...(p.fieldId ? { field: labels.get(p.fieldId) ?? p.fieldId } : {}),
            })),
          }
        : {}),
    }
  }

  // Which form and version, and whether a newer version of that form has been published since.
  private async describeFormOf(version: QuestionnaireVersion) {
    const [form, published] = await Promise.all([
      this.prisma.questionnaire.findUnique({ where: { id: version.questionnaireId } }),
      this.prisma.questionnaireVersion.findFirst({
        where: { questionnaireId: version.questionnaireId, status: 'published' },
      }),
    ])
    return {
      id: version.questionnaireId,
      name: form?.name ?? null,
      version: version.version,
      versionStatus: version.status,
      latestPublishedVersion: published?.version ?? null,
    }
  }
}

// Documents answering each attachment field, as the level may read them. No download URL here:
// reading the files through MCP is E04.03.
function documentsByField(groups: DocumentGroup[]) {
  const byField = new Map<
    string,
    Array<{ filename: string; version: number; availability: string; size: number }>
  >()
  for (const group of groups) {
    if (!group.fieldId) continue
    const list = byField.get(group.fieldId) ?? []
    list.push({
      filename: group.filename,
      version: group.current.version,
      availability: group.current.availability,
      size: group.current.size,
    })
    byField.set(group.fieldId, list)
  }
  return byField
}

function requireAdmin(caller: McpCaller): void {
  if (caller.user.role !== 'admin') {
    throw new ToolError('Réservé aux administrateurs de Confluent.')
  }
}

// The current answer; for a list, the choice key with the label it displays.
function describeAnswer(field: QuestionnaireField, answer: string | null) {
  if (field.fieldType !== 'select') return { answer }
  const answerLabel = readChoices(field.choices).find((c) => c.key === answer)?.label
  return { answer, ...(answerLabel ? { answerLabel } : {}) }
}
