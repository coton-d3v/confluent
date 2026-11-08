import { Injectable, NotFoundException } from '@nestjs/common'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AccessLevel } from '@confluent/shared'
import type { Dossier } from '@prisma/client'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { AnswersService } from '../answers/answers.service'
import { InvalidAnswersException } from '../answers/invalid-answers.exception'
import { AuditService } from '../audit/audit.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { DossiersService } from '../dossiers/dossiers.service'
import { fieldVisibleAt, projectDossierForLevel } from '../dossiers/financeur-access'
import { OAUTH_SCOPES, expandScopes } from '../oauth/oauth.constants'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'

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
  update_answers: OAUTH_SCOPES.write,
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
    private readonly audit: AuditService,
  ) {}

  // One server per HTTP request (stateless transport), bound to the caller.
  createServer(caller: McpCaller): McpServer {
    const server = new McpServer(
      { name: 'confluent', title: 'Confluent', version: process.env.APP_VERSION ?? 'dev' },
      {
        instructions:
          'Confluent héberge les dossiers de financement d’entreprises innovantes. Commencez par ' +
          'list_dossiers, puis get_dossier pour lire les questions (avec leur fieldId, type, options ' +
          'et réponse actuelle) et voir ce qui manque. update_answers enregistre des réponses ; ' +
          'n’inventez jamais une réponse : demandez-la à l’utilisateur.',
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
          'Questions du dossier (version de questionnaire du dossier), groupées par section, avec ' +
          'pour chacune fieldId, type, options, obligatoire, et réponse actuelle ; plus la liste des ' +
          'champs obligatoires sans réponse. Utilisez les fieldId pour update_answers.',
        inputSchema: { dossier: dossierRef },
        annotations: { readOnlyHint: true },
      },
      ({ dossier }) =>
        run('get_dossier', dossier, async () => {
          const { row, accessLevel } = await this.resolve(caller.user, dossier)
          return this.describeDossier(row, accessLevel, caller)
        }),
    )

    server.registerTool(
      'update_answers',
      {
        title: 'Enregistrer des réponses',
        description:
          'Enregistre une ou plusieurs réponses dans un dossier dont vous êtes propriétaire. ' +
          'Chaque réponse cible un fieldId de get_dossier. Valeurs : texte libre ; nombre ("1200" ou ' +
          '"3,5") ; date "AAAA-MM-JJ" ; case à cocher "true"/"false" ; liste : exactement une des ' +
          'options. Une chaîne vide efface la réponse. Rien n’est enregistré si une valeur est invalide.',
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
        run('update_answers', dossier, async () => {
          if (!expandScopes(caller.scopes).has(OAUTH_SCOPES.write)) {
            throw new ToolError('Permission « dossiers:write » non accordée à cette application.')
          }
          const { row } = await this.resolve(caller.user, dossier)
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
          const after = await this.describeDossier(row, 'complet', caller)
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
      fn: () => Promise<Record<string, unknown>>,
    ): Promise<CallToolResult> => {
      let result: 'ok' | 'error' = 'ok'
      let dossierId: string | null = null
      try {
        const data = await fn()
        dossierId = (data as { dossier?: { id?: string } }).dossier?.id ?? null
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
          dossierId: dossierId && UUID.test(dossierId) ? dossierId : null,
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

  private async resolve(user: AuthenticatedUser, ref: string) {
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
    return { row: dossier, accessLevel }
  }

  private async describeDossier(dossier: Dossier, accessLevel: AccessLevel, caller: McpCaller) {
    const structure = await this.questionnaires.getVersion(dossier.questionnaireVersionId)
    const fields = (structure?.fields ?? []).filter((f) => fieldVisibleAt(f, accessLevel))
    const visible = new Set(fields.map((f) => f.id))
    const answers = new Map(
      (await this.answers.listForDossier(dossier.id))
        .filter((a) => visible.has(a.fieldId))
        .map((a) => [a.fieldId, a.value]),
    )
    // Sections in their defined order, each with its visible fields (already ordered).
    const sections = (structure?.sections ?? [])
      .map((section) => ({
        title: section.title,
        fields: fields
          .filter((f) => f.sectionId === section.id)
          .map((f) => ({
            fieldId: f.id,
            key: f.key,
            label: f.label,
            ...(f.helpText ? { help: f.helpText } : {}),
            type: f.fieldType,
            required: f.required,
            ...(f.options.length ? { options: f.options } : {}),
            answer: answers.get(f.id) ?? null,
          })),
      }))
      .filter((section) => section.fields.length > 0)
    const projected = projectDossierForLevel(dossier, accessLevel)
    const isOwner = dossier.userId === caller.user.id
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
      canEdit: isOwner && expandScopes(caller.scopes).has(OAUTH_SCOPES.write),
      sections,
      missingRequired: fields
        .filter((f) => f.required && !(answers.get(f.id) ?? '').trim())
        .map((f) => ({ fieldId: f.id, label: f.label })),
    }
  }
}
