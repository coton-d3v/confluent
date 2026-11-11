import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FINANCING_STATUS_LABELS,
  WORKSPACE_MEMBER_ROLE_LABELS,
  canPrepareCompanies,
  canReviewCandidatures,
} from '@confluent/shared'
import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import { z } from 'zod'
import type { AppConfig } from '../../config/config.schema'
import { CandidaturesService } from '../candidatures/candidatures.service'
import { CompanyTransfersService } from '../company-transfers/company-transfers.service'
import { OAUTH_SCOPES } from '../oauth/oauth.constants'
import { readChoices } from '../questionnaires/questionnaire-structure'
import { canManageWorkspace } from '../workspaces/workspace-access'
import { WorkspaceMembersService } from '../workspaces/workspace-members.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { describeFinancingStatus } from './follow-up.tools'
import { McpAccess, serviceCall } from './mcp-access'
import type { McpCaller } from './mcp.tools'
import type { ToolRunner } from './tool-kit'

export const WORKSPACE_TOOL_SCOPES: Record<string, string> = {
  list_workspaces: OAUTH_SCOPES.read,
  get_workspace: OAUTH_SCOPES.read,
  list_received_candidatures: OAUTH_SCOPES.read,
  get_received_candidature: OAUTH_SCOPES.read,
}

export function workspaceInstructions(caller: McpCaller): string {
  if (caller.workspaceIds.length === 0) {
    return (
      'Workspaces : aucun n’est autorisé pour cette application (list_workspaces) ; l’utilisateur ' +
      'peut la reconnecter et cocher ceux qu’elle pourra voir.'
    )
  }
  return (
    'Workspaces (structures : incubateurs, réseaux, clubs…) : l’application ne voit que ceux que ' +
    'l’utilisateur a autorisés, selon son rôle dans chacun (list_workspaces). get_workspace en ' +
    'donne l’identité et, selon le rôle, les membres (gestionnaires) et les entreprises préparées ' +
    '(conseillers) ; list_received_candidatures et get_received_candidature lisent les ' +
    'candidatures reçues (conseillers). Aucun outil n’invite, ne désactive un membre ni ne change ' +
    'des droits : cela se fait dans le site.'
  )
}

const workspaceRef = z
  .string()
  .min(1)
  .describe('workspaceId ou slug, tel que renvoyé par list_workspaces.')

// E05.10: what a member reads of a workspace (E05.01–E05.09) in conversation, for the workspaces the
// person allowed this connection to reach only, and by their role there (McpAccess then the
// services' own rules: managing it, preparing companies, reviewing candidatures). Read only: no
// tool invites or deactivates a member, nor changes anyone's rights (E04.09).
@Injectable()
export class WorkspaceTools {
  constructor(
    private readonly access: McpAccess,
    private readonly workspaces: WorkspacesService,
    private readonly members: WorkspaceMembersService,
    private readonly transfers: CompanyTransfersService,
    private readonly candidatures: CandidaturesService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  register(server: McpServer, caller: McpCaller, run: ToolRunner): void {
    const site = this.config.get('FRONTEND_URL', { infer: true })

    server.registerTool(
      'list_workspaces',
      {
        title: 'Mes workspaces',
        description:
          'Workspaces (structures) que l’utilisateur a autorisé cette application à voir, parmi ' +
          'ceux dont il est membre actif, avec son rôle (conseiller ou investisseur) et s’il les ' +
          'gère. Les autres ne sont pas visibles : il peut reconnecter l’application pour les ' +
          'ajouter.',
        annotations: { readOnlyHint: true },
      },
      () =>
        run('list_workspaces', null, async () => {
          const memberships = await this.members.listMine(caller.user)
          const allowed = memberships.filter((m) => this.access.allows(caller, m.workspace.id))
          return {
            workspaces: allowed.map((m) => ({
              workspaceId: m.workspace.id,
              slug: m.workspace.slug,
              name: m.workspace.name,
              programName: m.workspace.programName,
              role: m.role,
              roleLabel: WORKSPACE_MEMBER_ROLE_LABELS[m.role],
              canManageWorkspace: canManageWorkspace(caller.user, { ...m, deactivatedAt: null }),
              siteUrl: `${site}/workspaces/${m.workspace.id}`,
            })),
            ...(allowed.length
              ? {}
              : {
                  notice:
                    'Aucun workspace n’est autorisé pour cette application. L’utilisateur peut la ' +
                    'reconnecter et cocher, sur l’écran d’autorisation de Confluent, les ' +
                    'workspaces qu’elle pourra voir. Ses propres dossiers restent accessibles.',
                }),
          }
        }),
    )

    // A connection allowed no workspace has no use for the rest (closed by default).
    if (caller.workspaceIds.length === 0) return

    server.registerTool(
      'get_workspace',
      {
        title: 'Lire un workspace',
        description:
          'Un workspace autorisé : identité (nom, programme, présentation, contact), votre rôle et ' +
          'vos droits ; pour un gestionnaire, ses membres ; pour un conseiller, les entreprises ' +
          'préparées pour des entrepreneurs et l’état de leur proposition.',
        inputSchema: { workspace: workspaceRef },
        annotations: { readOnlyHint: true },
      },
      ({ workspace }) =>
        run('get_workspace', workspace, async (trace) => {
          const scope = await this.access.workspace(caller, workspace, trace)
          const id = scope.workspace.id
          const entered = await serviceCall(() => this.workspaces.enter(caller.user, id))
          const manages = entered.canManageWorkspace
          const prepares = canPrepareCompanies(scope.membership)
          const reviews = canReviewCandidatures(caller.user, scope.membership)
          const [members, prepared] = await Promise.all([
            manages ? serviceCall(() => this.members.list(caller.user, id)) : null,
            prepares ? serviceCall(() => this.transfers.listPrepared(caller.user, id)) : null,
          ])
          // No logo: a signed URL would end up in the conversation.
          const { slug, name, programName, color, presentation, contactEmail } = entered.workspace
          return {
            workspace: {
              workspaceId: id,
              slug,
              name,
              programName,
              color,
              presentation,
              contactEmail,
              siteUrl: `${site}/workspaces/${id}`,
            },
            membership: entered.membership && {
              role: entered.membership.role,
              roleLabel: WORKSPACE_MEMBER_ROLE_LABELS[entered.membership.role],
              organization: entered.membership.organization,
              investorType: entered.membership.investorType,
            },
            rights: {
              manageWorkspace: manages,
              prepareCompanies: prepares,
              reviewCandidatures: reviews,
              ...(manages
                ? {
                    designForms:
                      'Formulaires du workspace : list_forms et get_form avec workspace ; ' +
                      'conception avec la permission « forms:write ».',
                  }
                : {}),
            },
            ...(members
              ? {
                  members: members.map((m) => ({
                    email: m.user.email,
                    firstName: m.user.firstName,
                    lastName: m.user.lastName,
                    role: m.role,
                    organization: m.organization,
                    investorType: m.investorType,
                    canManageWorkspace: m.canManageWorkspace,
                    status: m.status === 'active' ? 'actif' : 'desactive',
                    invitedAt: m.invitedAt,
                  })),
                  membersNote:
                    'Inviter, désactiver un membre ou changer ses droits se fait dans le site.',
                }
              : {}),
            ...(prepared
              ? {
                  preparedCompanies: prepared.map((p) => ({
                    company: p.company,
                    heldByMe: p.heldByMe,
                    held: p.held,
                    invitation: p.invitation,
                  })),
                  preparedNote:
                    'Préparer une entreprise, inviter son entrepreneur ou retirer une proposition se ' +
                    'fait dans le site ; les demandes d’une entreprise que vous tenez se remplissent ' +
                    'ici comme vos dossiers (list_dossiers).',
                }
              : {}),
          }
        }),
    )

    server.registerTool(
      'list_received_candidatures',
      {
        title: 'Candidatures reçues',
        description:
          'Conseillers d’un workspace autorisé : les candidatures envoyées à ce workspace, les ' +
          'plus récentes d’abord (entreprise, demande, montant, types, date d’envoi). Les ' +
          'brouillons restent privés à leur auteur.',
        inputSchema: { workspace: workspaceRef },
        annotations: { readOnlyHint: true },
      },
      ({ workspace }) =>
        run('list_received_candidatures', workspace, async (trace) => {
          const { workspace: ws } = await this.access.workspace(caller, workspace, trace)
          const rows = await serviceCall(() => this.candidatures.listReceived(caller.user, ws.id))
          return {
            workspace: { workspaceId: ws.id, name: ws.name },
            candidatures: rows.map((c) => ({
              candidatureId: c.id,
              submittedAt: c.submittedAt,
              company: c.company.name,
              request: c.dossier,
              financingStatus: c.financingStatus,
              financingStatusLabel: FINANCING_STATUS_LABELS[c.financingStatus],
              siteUrl: `${site}/workspaces/${ws.id}/candidatures/${c.id}`,
            })),
          }
        }),
    )

    server.registerTool(
      'get_received_candidature',
      {
        title: 'Lire une candidature reçue',
        description:
          'Conseillers d’un workspace autorisé : une candidature envoyée à ce workspace — ' +
          'présentation de la demande, profil commun de l’entreprise (sans pièces jointes) et ' +
          'réponses au formulaire du workspace, question par question.',
        inputSchema: {
          workspace: workspaceRef,
          candidature: z
            .string()
            .uuid()
            .describe('candidatureId renvoyé par list_received_candidatures.'),
        },
        annotations: { readOnlyHint: true },
      },
      ({ workspace, candidature }) =>
        run('get_received_candidature', candidature, async (trace) => {
          const { workspace: ws } = await this.access.workspace(caller, workspace, trace)
          const view = await serviceCall(() =>
            this.candidatures.getReceived(caller.user, ws.id, candidature),
          )
          trace.candidatureId = view.id
          return {
            candidatureId: view.id,
            submittedAt: view.submittedAt,
            workspace: { workspaceId: ws.id, name: ws.name },
            company: view.company.name,
            applicant: view.applicant,
            request: view.dossier,
            profile: {
              version: view.profile.version.version,
              sections: answeredSections(
                view.profile.sections,
                view.profile.fields,
                view.profile.answers,
              ),
            },
            form: {
              name: view.form.name,
              version: view.form.version.version,
              sections: answeredSections(view.form.sections, view.form.fields, view.form.answers),
            },
            // E06.09: its financing status, and what the structure may change in it.
            financingStatus: describeFinancingStatus(view, 'workspace'),
            followUp:
              'Plan de financement, dispositifs et parcours : get_funding_plan, ' +
              'list_eligibilities et get_support_path avec workspace ; notes internes : ' +
              'get_intervention_journal.',
            siteUrl: `${site}/workspaces/${ws.id}/candidatures/${view.id}`,
          }
        }),
    )
  }
}

// Each section with its questions and the answer given (for a list, the choice's label too).
function answeredSections(
  sections: QuestionnaireSection[],
  fields: QuestionnaireField[],
  answers: Array<{ fieldId: string; value: string }>,
) {
  const byField = new Map(answers.map((a) => [a.fieldId, a.value]))
  return sections
    .map((section) => ({
      title: section.title,
      questions: fields
        .filter((f) => f.sectionId === section.id)
        .map((f) => {
          const answer = byField.get(f.id) ?? null
          const label =
            f.fieldType === 'select'
              ? readChoices(f.choices).find((c) => c.key === answer)?.label
              : undefined
          return {
            fieldId: f.id,
            label: f.label,
            type: f.fieldType,
            answer,
            ...(label ? { answerLabel: label } : {}),
          }
        }),
    }))
    .filter((section) => section.questions.length > 0)
}
