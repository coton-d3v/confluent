import { HttpException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABELS,
  SUPPORT_PHASES,
  SUPPORT_PHASE_LABELS,
  createCandidatureNoteSchema,
  portfolioQuerySchema,
  updateCandidatureNoteSchema,
} from '@confluent/shared'
import { z } from 'zod'
import type { AppConfig } from '../../config/config.schema'
import { CandidatureNotesService } from '../interventions/candidature-notes.service'
import {
  InterventionJournalService,
  type InterventionJournalView,
} from '../interventions/intervention-journal.service'
import { OAUTH_SCOPES, expandScopes } from '../oauth/oauth.constants'
import { PortfolioService } from '../support-paths/portfolio.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import { describeProgress } from './follow-up.tools'
import { McpAccess, serviceCall } from './mcp-access'
import type { McpCaller } from './mcp.tools'
import {
  ToolError,
  contract,
  defined,
  requireScope,
  type ToolRunner,
  type ToolTrace,
} from './tool-kit'

// ROADMAP E06.09: what a structure keeps on the candidatures it receives, for its conseillers in
// conversation — its portfolio by phase (E06.07), and its internal notes with the journal of its
// interventions (E06.08) —, through the services the site uses, for the workspaces the person
// allowed this connection to reach (McpAccess.workspace, at each call) and by the candidatures'
// rule (active conseillers and administrators members of it). The notes are the structure's
// working material: reading or writing them needs `candidatures:support`, a permission of its own
// that no authorization given before it holds (R52) — their tools are not even listed without it —;
// they never reach the owner of the request,
// another workspace or a share, and the calls are journaled with the workspace and the candidature,
// never on the request's journal, which its owner reads.
export const STRUCTURE_TOOL_SCOPES: Record<string, string> = {
  get_portfolio: OAUTH_SCOPES.read,
  get_intervention_journal: OAUTH_SCOPES.support,
  add_internal_note: OAUTH_SCOPES.support,
  update_internal_note: OAUTH_SCOPES.support,
  delete_internal_note: OAUTH_SCOPES.support,
}

export const STRUCTURE_INSTRUCTIONS =
  'Conseillers : get_portfolio donne le portefeuille des candidatures reçues par phase ' +
  'd’accompagnement (en préparation et étape en cours, prête à lever, sans parcours) avec filtres. ' +
  'Les notes internes (get_intervention_journal, add_internal_note…, avec la permission ' +
  '« candidatures:support ») restent à la structure : ' +
  'jamais montrées à l’entreprise, à un investisseur ni à une autre structure ; ne les recopiez ' +
  'pas dans un message destiné à l’entreprise.'

const workspaceRef = z
  .string()
  .min(1)
  .describe('workspaceId ou slug, tel que renvoyé par list_workspaces.')
const candidatureRef = z
  .string()
  .uuid()
  .describe('candidatureId d’une candidature reçue (get_portfolio, list_received_candidatures).')
const noteBody = z
  .string()
  .describe('Texte simple par paragraphes, 4 000 caractères au plus, sans balise HTML.')

const RECEIVED_NOT_FOUND =
  'Candidature introuvable dans ce workspace (inconnue, encore en brouillon ou envoyée à un autre ' +
  'workspace). Utilisez get_portfolio.'

@Injectable()
export class StructureTools {
  constructor(
    private readonly access: McpAccess,
    private readonly portfolio: PortfolioService,
    private readonly journal: InterventionJournalService,
    private readonly notes: CandidatureNotesService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  register(server: McpServer, caller: McpCaller, run: ToolRunner): void {
    // A connection allowed no workspace has no use for them (closed by default).
    if (caller.workspaceIds.length === 0) return
    const site = this.config.get('FRONTEND_URL', { infer: true })
    const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    const idempotent = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true }

    server.registerTool(
      'get_portfolio',
      {
        title: 'Portefeuille des candidatures reçues',
        description:
          'Conseillers d’un workspace autorisé : les candidatures reçues par phase ' +
          'd’accompagnement, calculée à chaque lecture comme dans le site — compteurs par phase et ' +
          'par étape en cours, puis une page de 25 candidatures (entreprise, demande, statut de ' +
          'financement, dispositifs, phase et étape en cours). Filtres facultatifs : phase, étape ' +
          'en cours, statut de financement, dispositif, dispositif vérifié. Accompagnement (phase) ' +
          'et financement (statut) sont deux axes distincts.',
        inputSchema: {
          workspace: workspaceRef,
          phase: z
            .enum(SUPPORT_PHASES)
            .optional()
            .describe(
              'in_progress : en préparation ; ready : prête à lever ; no_path : sans parcours.',
            ),
          step: z.string().optional().describe('stepId de l’étape en cours (counts.steps).'),
          financingStatus: z.enum(FINANCING_STATUSES).optional(),
          scheme: z.string().optional().describe('schemeId d’un dispositif du workspace.'),
          verified: z.boolean().optional().describe('true : dispositif vérifié par la structure.'),
          page: z.number().int().optional().describe('Page (1 par défaut).'),
        },
        annotations: { readOnlyHint: true },
      },
      ({ workspace, verified, ...filters }) =>
        run('get_portfolio', workspace, async (trace) => {
          const { workspace: ws } = await this.access.workspace(caller, workspace, trace)
          const query = contract(portfolioQuerySchema, {
            ...defined(filters),
            ...(verified === undefined ? {} : { verified: String(verified) }),
          })
          const view = await serviceCall(() => this.portfolio.get(caller.user, ws.id, query))
          return {
            workspace: { workspaceId: ws.id, name: ws.name },
            counts: {
              total: view.counts.total,
              phases: SUPPORT_PHASES.map((phase) => ({
                phase,
                label: SUPPORT_PHASE_LABELS[phase],
                count: view.counts.phases[phase],
              })),
              currentSteps: view.counts.steps,
            },
            matching: view.total,
            page: view.page,
            pages: Math.max(1, Math.ceil(view.total / view.pageSize)),
            candidatures: view.items.map((item) => ({
              candidatureId: item.id,
              company: item.company.name,
              request: item.dossier,
              submittedAt: item.submittedAt,
              financingStatus: item.financingStatus,
              financingStatusLabel: FINANCING_STATUS_LABELS[item.financingStatus],
              eligibilities: item.eligibilities,
              progress: describeProgress(item.progress),
              siteUrl: `${site}/workspaces/${ws.id}/candidatures/${item.id}`,
            })),
          }
        }),
    )

    // The structure's internal notes are listed only to a connection the person allowed to follow
    // its candidatures: an authorization given without that permission never even sees them.
    if (!expandScopes(caller.scopes).has(OAUTH_SCOPES.support)) return

    server.registerTool(
      'get_intervention_journal',
      {
        title: 'Notes internes et journal d’une candidature',
        description:
          'Conseillers d’un workspace autorisé, avec la permission « candidatures:support » : les ' +
          'notes internes de la structure sur une candidature reçue et le journal de ses ' +
          'interventions (statuts de financement, lignes du plan, dispositifs, étapes validées), ' +
          'le plus récent d’abord, avec l’auteur. Une note supprimée garde sa trace sans texte ; ' +
          'mine indique les notes de l’utilisateur, seules modifiables. Ces notes restent à la ' +
          'structure : ne les transmettez jamais à l’entreprise.',
        inputSchema: {
          workspace: workspaceRef,
          candidature: candidatureRef,
          notesOnly: z.boolean().optional().describe('true : les notes seulement.'),
        },
        annotations: { readOnlyHint: true },
      },
      ({ workspace, candidature, notesOnly }) =>
        run('get_intervention_journal', candidature, async (trace) => {
          requireScope(caller, OAUTH_SCOPES.support)
          const actor = await this.reach(caller, workspace, trace)
          const view = await this.call(trace, () =>
            this.journal.get(actor.user, actor.workspaceId, candidature),
          )
          return this.describeJournal(view, notesOnly === true, site)
        }),
    )

    server.registerTool(
      'add_internal_note',
      {
        title: 'Écrire une note interne',
        description:
          'Conseillers d’un workspace autorisé, avec « candidatures:support » : ajoute une note ' +
          'interne de la structure sur une candidature reçue (500 au plus), lue par ses seuls ' +
          'conseillers, jamais par l’entreprise. Renvoie le journal à jour.',
        inputSchema: { workspace: workspaceRef, candidature: candidatureRef, body: noteBody },
        annotations: write,
      },
      ({ workspace, candidature, body }) =>
        run('add_internal_note', candidature, async (trace) => {
          requireScope(caller, OAUTH_SCOPES.support)
          const input = contract(createCandidatureNoteSchema, { body })
          const actor = await this.reach(caller, workspace, trace)
          const view = await this.call(trace, () =>
            this.notes.create(actor.user, actor.workspaceId, candidature, input),
          )
          return { message: 'Note enregistrée.', ...this.describeJournal(view, true, site) }
        }),
    )

    server.registerTool(
      'update_internal_note',
      {
        title: 'Réécrire une note interne',
        description:
          'Réécrit une note interne dont l’utilisateur est l’auteur (mine), depuis sa version lue ; ' +
          'une note modifiée ou supprimée entre-temps est refusée, jamais écrasée. Permission ' +
          '« candidatures:support ».',
        inputSchema: {
          workspace: workspaceRef,
          candidature: candidatureRef,
          noteId: z.string().uuid().describe('noteId (get_intervention_journal).'),
          version: z.number().int().min(1).describe('version de la note telle que lue.'),
          body: noteBody,
        },
        annotations: idempotent,
      },
      ({ workspace, candidature, noteId, version, body }) =>
        run('update_internal_note', candidature, async (trace) => {
          requireScope(caller, OAUTH_SCOPES.support)
          const input = contract(updateCandidatureNoteSchema, { body, version })
          const actor = await this.reach(caller, workspace, trace)
          const view = await this.call(trace, () =>
            this.notes.edit(actor.user, actor.workspaceId, candidature, noteId, input),
          )
          return { message: 'Note réécrite.', ...this.describeJournal(view, true, site) }
        }),
    )

    server.registerTool(
      'delete_internal_note',
      {
        title: 'Supprimer une note interne',
        description:
          'Supprime une note interne dont l’utilisateur est l’auteur, depuis sa version lue : son ' +
          'texte est effacé, le journal garde la trace « note supprimée ». Irréversible. ' +
          'Permission « candidatures:support ».',
        inputSchema: {
          workspace: workspaceRef,
          candidature: candidatureRef,
          noteId: z.string().uuid().describe('noteId (get_intervention_journal).'),
          version: z.number().int().min(1).describe('version de la note telle que lue.'),
        },
        annotations: destructive,
      },
      ({ workspace, candidature, noteId, version }) =>
        run('delete_internal_note', candidature, async (trace) => {
          requireScope(caller, OAUTH_SCOPES.support)
          const actor = await this.reach(caller, workspace, trace)
          const view = await this.call(trace, () =>
            this.notes.remove(actor.user, actor.workspaceId, candidature, noteId, version),
          )
          return { message: 'Note supprimée.', ...this.describeJournal(view, true, site) }
        }),
    )
  }

  // The workspace this connection reaches now; the services then apply the candidatures' rule.
  private async reach(
    caller: McpCaller,
    workspace: string,
    trace: ToolTrace,
  ): Promise<{ user: WorkspaceActor; workspaceId: string }> {
    const scope = await this.access.workspace(caller, workspace, trace)
    return { user: caller.user, workspaceId: scope.workspace.id }
  }

  // Refused as the site refuses it; the call is noted with the candidature once reached.
  private async call(
    trace: ToolTrace,
    operation: () => Promise<InterventionJournalView>,
  ): Promise<InterventionJournalView> {
    const view = await serviceCall(async () => {
      try {
        return await operation()
      } catch (err) {
        const code =
          err instanceof HttpException
            ? (err.getResponse() as { code?: unknown; message?: unknown })
            : null
        if (code?.code === 'CANDIDATURE_NOT_FOUND') throw new ToolError(RECEIVED_NOT_FOUND)
        if (code?.code === 'CANDIDATURE_NOTE_CHANGED' && typeof code.message === 'string') {
          throw new ToolError(
            `Rien n’a été écrit. ${code.message} Relisez avec get_intervention_journal.`,
          )
        }
        throw err
      }
    })
    trace.candidatureId = view.candidatureId
    return view
  }

  private describeJournal(view: InterventionJournalView, notesOnly: boolean, site: string) {
    const entries = notesOnly ? view.entries.filter((e) => e.kind === 'note') : view.entries
    return {
      candidatureId: view.candidatureId,
      workspaceId: view.workspaceId,
      internal:
        'Notes et journal internes à la structure : jamais transmis à l’entreprise, à un ' +
        'investisseur ni à une autre structure.',
      entries: entries.map((e) =>
        e.kind === 'note'
          ? {
              kind: e.kind,
              at: e.at,
              actor: e.actor,
              noteId: e.note.id,
              body: e.note.body,
              version: e.note.version,
              editedAt: e.note.editedAt,
              deleted: e.note.deletedAt !== null,
              mine: e.note.mine,
            }
          : e,
      ),
      siteUrl: `${site}/workspaces/${view.workspaceId}/candidatures/${view.candidatureId}`,
    }
  }
}
