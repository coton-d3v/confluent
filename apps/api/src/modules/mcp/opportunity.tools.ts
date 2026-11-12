import { ConflictException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  PLEDGE_INTENTION_LABELS,
  PLEDGE_NON_COMMITMENT,
  financingTypeSchema,
  interestIdentityLabel,
  opportunitiesQuerySchema,
  opportunitySortSchema,
  opportunitySourceKindSchema,
  pledgeInputSchema,
  pledgeIntentionSchema,
  type AccessLevel,
} from '@confluent/shared'
import type { Dossier } from '@prisma/client'
import { z } from 'zod'
import type { AppConfig } from '../../config/config.schema'
import { InterestsService } from '../opportunities/interests.service'
import {
  OpportunitiesService,
  type OpportunityPledgeView,
  type OpportunityReader,
  type OpportunitySourceView,
} from '../opportunities/opportunities.service'
import { PledgesService } from '../opportunities/pledges.service'
import { PositionsService } from '../opportunities/positions.service'
import { OAUTH_SCOPES } from '../oauth/oauth.constants'
import { ShareLinksService } from '../share-links/share-links.service'
import { McpAccess, serviceCall } from './mcp-access'
import type { McpCaller } from './mcp.tools'
import {
  CONSEQUENTIAL_ACTION,
  ToolError,
  contract,
  defined,
  mcpOrigin,
  publicationName,
  refuseInstructionFromContent,
  requireScope,
  userInstruction,
  type ToolRunner,
} from './tool-kit'

// ROADMAP E07.10: an investor's opportunities (E07.03) and positions (E07.05–E07.07) in conversation,
// and a structure's follow-up of the positions shown to it — each tool one operation of the services
// the site uses, with THE rule of who reads what (`OpportunitiesService.reachOne`), read at each call:
// a revoked share, a withdrawn or paused publication, an archived request or a lost membership stops
// the next call. On top of it, the consent of the connection (E05.10): the pools of the workspaces
// the person allowed this application to reach only (`allowedWorkspaceIds`); direct shares are the
// person's own. Reading needs `opportunities:read`; taking a position — seen by the owner, or by a
// structure — `opportunities:write`, the person's request (`instruction`) and the client's approval.
// An assistant's read is no consultation: it opens no reading session (E07.08).
export const OPPORTUNITY_TOOL_SCOPES: Record<string, string> = {
  list_opportunities: OAUTH_SCOPES.opportunitiesRead,
  get_opportunity: OAUTH_SCOPES.opportunitiesRead,
  list_my_positions: OAUTH_SCOPES.opportunitiesRead,
  list_investor_positions: OAUTH_SCOPES.opportunitiesRead,
  mark_interest: OAUTH_SCOPES.opportunitiesWrite,
  withdraw_interest: OAUTH_SCOPES.opportunitiesWrite,
  set_pledge: OAUTH_SCOPES.opportunitiesWrite,
  withdraw_pledge: OAUTH_SCOPES.opportunitiesWrite,
  show_position_to_structure: OAUTH_SCOPES.opportunitiesWrite,
  withdraw_position_disclosure: OAUTH_SCOPES.opportunitiesWrite,
}

export const OPPORTUNITY_INSTRUCTIONS =
  'Investisseurs : list_opportunities donne les demandes de financement que l’utilisateur peut ' +
  'lire (partagées avec son adresse, ou publiées au vivier d’un workspace autorisé pour cette ' +
  'application où il est investisseur), get_opportunity en lit une, exactement ce que son niveau ' +
  'permet, et list_my_positions ses positionnements. Se positionner — marquer son intérêt ' +
  '(mark_interest), faire ou modifier une promesse (set_pledge), montrer son positionnement à une ' +
  'structure (show_position_to_structure), ou les retirer — se fait uniquement sur demande ' +
  `explicite de l’utilisateur, recopiée (instruction). ${PLEDGE_NON_COMMITMENT} Ne choisissez ` +
  'jamais à sa place ce qui est montré au porteur (nameVisible, showName, showAmount) : ' +
  'demandez-le-lui.'

const opportunityRef = z
  .string()
  .uuid()
  .describe('dossierId de l’opportunité, tel que renvoyé par list_opportunities.')

const NAME_HIDDEN_NOTE =
  'Le porteur compte toutes les marques et promesses des investisseurs qui lisent la demande : ' +
  'seul votre nom ou votre montant peut être caché, pas leur existence.'

// The reader, from the token only, and the pools this connection may reach.
function readerOf(caller: McpCaller): OpportunityReader {
  return {
    id: caller.user.id,
    email: caller.user.email,
    allowedWorkspaceIds: caller.workspaceIds,
  }
}

function describeSource(source: OpportunitySourceView) {
  return source.kind === 'share'
    ? {
        kind: 'share',
        label: 'partage nominatif',
        accessLevel: source.accessLevel,
        since: source.since,
      }
    : {
        kind: 'pool',
        label: `vivier de ${source.workspace.name}`,
        accessLevel: source.accessLevel,
        since: source.since,
        workspace: { workspaceId: source.workspace.id, name: source.workspace.name },
      }
}

function describePledge(pledge: OpportunityPledgeView | null) {
  if (!pledge) return null
  return {
    ...pledge,
    intentionLabel: PLEDGE_INTENTION_LABELS[pledge.intention],
    nonCommitment: PLEDGE_NON_COMMITMENT,
  }
}

// What the owner reads of the reader's pledge, as the site's form says it (E07.06).
function ownerSeesPledge(pledge: OpportunityPledgeView): string {
  const shown = [
    pledge.showName ? 'votre nom' : null,
    pledge.showAmount ? 'votre montant' : null,
  ].filter(Boolean)
  return (
    'Le porteur voit le nombre et le total des promesses des investisseurs qui lisent la demande ' +
    '(seule promesse, votre montant se déduit du total)' +
    (shown.length
      ? `, et ${shown.join(' et ')}.`
      : ', sans votre nom ni votre montant individuel.') +
    ' Jamais votre intention, votre commentaire ni une date.'
  )
}

const pledgeChanged = () =>
  new ToolError(
    'Rien n’a été écrit : votre promesse a changé depuis la version lue (dans le site ou une autre ' +
      'conversation). Relisez-la (get_opportunity ou list_my_positions), montrez-la à ' +
      'l’utilisateur et repassez sa version telle que lue.',
  )

@Injectable()
export class OpportunityTools {
  constructor(
    private readonly access: McpAccess,
    private readonly opportunities: OpportunitiesService,
    private readonly interests: InterestsService,
    private readonly pledges: PledgesService,
    private readonly positions: PositionsService,
    private readonly shareLinks: ShareLinksService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // `describeShared`: the request as get_dossier describes it to a share recipient at `level` — THE
  // projection of the reading policy (E07.04), the same for every channel.
  register(
    server: McpServer,
    caller: McpCaller,
    run: ToolRunner,
    describeShared: (dossier: Dossier, level: AccessLevel) => Promise<Record<string, unknown>>,
  ): void {
    const site = this.config.get('FRONTEND_URL', { infer: true })
    const reader = readerOf(caller)

    server.registerTool(
      'list_opportunities',
      {
        title: 'Mes opportunités',
        description:
          'Investisseur : les demandes de financement que vous lisez maintenant — partagées avec ' +
          'votre adresse par un lien nominatif actif, ou publiées (ni retirées ni en pause) au ' +
          'vivier d’un workspace où vous êtes investisseur actif et que cette application est ' +
          'autorisée à voir —, une par demande au niveau le plus large, avec leurs provenances, ' +
          'votre marque d’intérêt et votre promesse. Ni vos propres demandes, ni les viviers des ' +
          'workspaces non autorisés. Filtres facultatifs (sur ce que le niveau montre), tri, pages ' +
          'de 20 ; counts : totaux, partages directs, chaque vivier, secteurs et types proposés.',
        inputSchema: {
          q: z.string().max(100).optional().describe('Recherche dans le titre et le résumé.'),
          sector: z.string().max(200).optional().describe('Un secteur proposé (counts.sectors).'),
          amountMin: z.number().int().min(0).optional().describe('Montant recherché minimum (€).'),
          amountMax: z.number().int().min(0).optional().describe('Montant recherché maximum (€).'),
          financingType: financingTypeSchema.optional(),
          source: opportunitySourceKindSchema
            .optional()
            .describe('share : partages nominatifs ; pool : viviers.'),
          workspace: z
            .string()
            .uuid()
            .optional()
            .describe('workspaceId d’un vivier (counts.pools).'),
          sort: opportunitySortSchema.optional(),
          page: z.number().int().min(1).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (input) =>
        run('list_opportunities', null, async () => {
          const filter = contract(opportunitiesQuerySchema, defined(input))
          const view = await this.opportunities.list(reader, filter)
          return {
            counts: {
              ...view.counts,
              pools: view.counts.pools.map((p) => ({
                workspace: { workspaceId: p.workspace.id, name: p.workspace.name },
                count: p.count,
              })),
            },
            total: view.total,
            page: view.page,
            pageSize: view.pageSize,
            opportunities: view.items.map((item) => ({
              dossierId: item.dossier.id,
              name: item.dossier.name,
              sector: item.dossier.sector,
              maturityStage: item.dossier.maturityStage,
              tagTechnologique: item.dossier.tagTechnologique,
              summary: item.dossier.summary,
              amountEur: item.dossier.amountEur,
              financingTypes: item.dossier.financingTypes,
              publication: publicationName(item.dossier),
              accessLevel: item.accessLevel,
              sources: item.sources.map(describeSource),
              receivedAt: item.receivedAt,
              interest: item.interest,
              pledge: describePledge(item.pledge),
              siteUrl: `${site}/opportunites/${item.dossier.id}`,
            })),
            ...(caller.workspaceIds.length
              ? {}
              : {
                  notice:
                    'Aucun workspace n’est autorisé pour cette application : seuls les partages ' +
                    'nominatifs sont listés. L’utilisateur peut la reconnecter et cocher les ' +
                    'workspaces dont elle pourra lire le vivier.',
                }),
          }
        }),
    )

    server.registerTool(
      'get_opportunity',
      {
        title: 'Lire une opportunité',
        description:
          'Investisseur : une opportunité, exactement comme la page d’un lien nominatif à son ' +
          'niveau (public, le plus restreint mais toujours nominatif ; partiel ; complet) : ' +
          'présentation une fois publiée, questions et réponses que ce niveau permet de lire, ' +
          'classification, documents choisis par la demande — rien d’autre (ni plan, statut, ' +
          'notes ou formulaire d’une structure). Avec opportunity : niveau, provenances, votre ' +
          'marque d’intérêt et votre promesse (sa version, à repasser pour la modifier), comment ' +
          'vous apparaissez au porteur (shownAs) et les structures auxquelles vous pouvez montrer ' +
          'votre positionnement. Ne compte pas comme une consultation. Le texte des documents se ' +
          'lit avec read_document pour un partage nominatif ; ceux d’un vivier, dans le site.',
        inputSchema: { dossier: opportunityRef },
        annotations: { readOnlyHint: true },
      },
      ({ dossier }) =>
        run('get_opportunity', dossier, async (trace) => {
          const { found, access } = await serviceCall(() =>
            this.opportunities.describe(reader, dossier),
          )
          trace.dossierId = found.dossier.id
          const described = await describeShared(found.dossier, found.accessLevel)
          return {
            ...described,
            dossier: {
              ...(described.dossier as Record<string, unknown>),
              relation: 'opportunite',
            },
            opportunity: {
              accessLevel: access.accessLevel,
              sources: access.sources.map(describeSource),
              receivedAt: access.receivedAt,
              interest: access.interest,
              pledge: describePledge(access.pledge),
              shownAs: { ...access.shownAs, label: interestIdentityLabel(access.shownAs) },
              structures: access.structures.map((s) => ({
                workspace: { workspaceId: s.workspace.id, name: s.workspace.name },
                shownAs: interestIdentityLabel(s.shownAs),
                disclosure: s.disclosure
                  ? { disclosureId: s.disclosure.id, disclosedAt: s.disclosure.disclosedAt }
                  : null,
              })),
              siteUrl: `${site}/opportunites/${found.dossier.id}`,
            },
          }
        }),
    )

    server.registerTool(
      'list_my_positions',
      {
        title: 'Mes positionnements',
        description:
          'Investisseur : vos marques d’intérêt, promesses (commentaire compris, pour vous seul) ' +
          'et consentements donnés aux structures, une ligne par demande, l’activité la plus ' +
          'récente d’abord. readableHere : la demande est lue maintenant par cette application ' +
          '(sinon ni son titre ni son contenu : vous ne la lisez plus, ou seulement par le vivier ' +
          'd’un workspace non autorisé ici) ; closed : archivée par son porteur, la promesse est ' +
          'close. Seuls les consentements donnés aux workspaces autorisés pour cette application ' +
          'sont listés. Jamais les positionnements d’un autre compte.',
        annotations: { readOnlyHint: true },
      },
      () =>
        run('list_my_positions', null, async () => {
          const mine = await this.positions.mine(reader)
          return {
            positions: mine.items.map((item) => ({
              dossierId: item.dossierId,
              readableHere: item.readable,
              closed: item.closed,
              dossier: item.dossier
                ? {
                    name: item.dossier.name,
                    sector: item.dossier.sector,
                    summary: item.dossier.summary,
                    amountEur: item.dossier.amountEur,
                    publication: publicationName(item.dossier),
                  }
                : null,
              accessLevel: item.accessLevel,
              interest: item.interest,
              pledge: describePledge(item.pledge),
              disclosures: item.disclosures
                .filter((d) => this.access.allows(caller, d.workspace.id))
                .map((d) => ({
                  disclosureId: d.id,
                  workspace: { workspaceId: d.workspace.id, name: d.workspace.name },
                  disclosedAt: d.disclosedAt,
                })),
            })),
            nonCommitment: PLEDGE_NON_COMMITMENT,
          }
        }),
    )

    server.registerTool(
      'mark_interest',
      {
        title: 'Marquer mon intérêt',
        description:
          'Investisseur, uniquement sur demande explicite de l’utilisateur : marque votre intérêt ' +
          'pour une opportunité que vous lisez maintenant, ou change seulement si votre nom est ' +
          'montré. Le porteur voit toujours le nombre de marques des investisseurs qui lisent la ' +
          'demande, et votre nom (nom du compte et organisation dans les structures dont le vivier ' +
          'vous l’apporte, jamais votre adresse) seulement si nameVisible vaut true — à demander ' +
          'à l’utilisateur, sans valeur par défaut. Personne d’autre ne la lit, sauf une structure ' +
          'à laquelle vous montrez votre positionnement. Demande archivée : ni nouvelle marque ni ' +
          'nom nouvellement montré.',
        inputSchema: {
          dossier: opportunityRef,
          nameVisible: z
            .boolean()
            .describe(
              'true : le porteur peut voir qui vous êtes ; false : votre marque est comptée sans ' +
                'votre nom. Choix de l’utilisateur, jamais supposé.',
            ),
          instruction: userInstruction('marquer son intérêt pour cette opportunité'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ dossier, nameVisible, instruction }) =>
        run('mark_interest', dossier, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          await this.refuseCopied(reader, dossier, instruction, 'Aucune marque d’intérêt')
          const interest = await serviceCall(() =>
            this.interests.mark(reader, dossier, { nameVisible }, mcpOrigin(caller, instruction)),
          )
          trace.dossierId = dossier
          return {
            message: nameVisible
              ? 'Intérêt marqué : le porteur le compte et voit votre nom.'
              : 'Intérêt marqué : le porteur le compte, sans votre nom.',
            interest,
            whatOwnerSees: NAME_HIDDEN_NOTE,
          }
        }),
    )

    server.registerTool(
      'withdraw_interest',
      {
        title: 'Retirer ma marque d’intérêt',
        description:
          'Investisseur, uniquement sur demande explicite de l’utilisateur : retire votre marque ' +
          'd’intérêt, que vous lisiez encore la demande ou non ; même réponse sans marque. Le ' +
          'porteur ne la compte plus.',
        inputSchema: {
          dossier: opportunityRef,
          instruction: userInstruction('retirer sa marque d’intérêt'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ dossier, instruction }) =>
        run('withdraw_interest', dossier, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          await this.refuseCopied(reader, dossier, instruction, 'Marque d’intérêt non retirée')
          await serviceCall(() =>
            this.interests.withdraw(reader, dossier, mcpOrigin(caller, instruction)),
          )
          return { message: 'Vous n’avez plus de marque d’intérêt sur cette demande.' }
        }),
    )

    server.registerTool(
      'set_pledge',
      {
        title: 'Faire ou modifier ma promesse',
        description:
          `${PLEDGE_NON_COMMITMENT} Investisseur, uniquement sur demande explicite de ` +
          'l’utilisateur : fait ou remplace votre promesse sur une opportunité que vous lisez ' +
          'maintenant — la promesse entière : intention, montant en euros entiers (1 € à 1 Md€), ' +
          'commentaire facultatif (pour vous seul ; absent, il est effacé : recopiez celui à ' +
          'garder), et deux choix sans valeur par défaut, à demander à l’utilisateur : montrer ' +
          'votre nom (showName) et votre montant (showAmount) au porteur. Le porteur voit ' +
          'toujours le nombre et le total des promesses, jamais l’intention ni le commentaire ; ' +
          'personne d’autre, sauf une structure à laquelle vous montrez votre positionnement ' +
          '(intention et montant, jamais le commentaire). version : celle de la promesse lue ' +
          '(pledge.version de get_opportunity ou list_my_positions), null pour une première ' +
          'promesse — repassée telle quelle, jamais calculée : une promesse changée entre-temps ' +
          'n’est jamais écrasée. Demande archivée (close) : seul masquer nom ou montant reste ' +
          'possible.',
        inputSchema: {
          dossier: opportunityRef,
          intention: pledgeIntentionSchema.describe(
            'exploring : à l’étude ; likely : probable ; strong : forte — jamais un engagement.',
          ),
          amountEur: z.number().int().describe('Montant envisagé, en euros entiers.'),
          comment: z
            .string()
            .max(2000)
            .optional()
            .describe('Commentaire pour vous seul (texte simple, 1 000 caractères au plus).'),
          showName: z.boolean().describe('Montrer votre nom au porteur : choix de l’utilisateur.'),
          showAmount: z
            .boolean()
            .describe('Montrer votre montant au porteur : choix de l’utilisateur.'),
          version: z
            .number()
            .int()
            .nullable()
            .describe('Version de la promesse lue ; null pour une première promesse.'),
          instruction: userInstruction('faire ou modifier sa promesse'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ dossier, instruction, ...wanted }) =>
        run('set_pledge', dossier, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          const input = contract(pledgeInputSchema, defined(wanted))
          await this.refuseCopied(reader, dossier, instruction, 'Aucune promesse enregistrée')
          const pledge = await serviceCall(async () => {
            try {
              return await this.pledges.set(reader, dossier, input, mcpOrigin(caller, instruction))
            } catch (err) {
              if (codeOf(err) === 'PLEDGE_CHANGED') throw pledgeChanged()
              throw err
            }
          })
          trace.dossierId = dossier
          return {
            message: `Promesse enregistrée. ${PLEDGE_NON_COMMITMENT}`,
            pledge: describePledge(pledge),
            whatOwnerSees: ownerSeesPledge(pledge),
            nextVersion:
              'Pour la modifier plus tard, repassez pledge.version telle quelle (version).',
          }
        }),
    )

    server.registerTool(
      'withdraw_pledge',
      {
        title: 'Retirer ma promesse',
        description:
          'Investisseur, uniquement sur demande explicite de l’utilisateur : retire votre ' +
          'promesse, que vous lisiez encore la demande ou non ; même réponse sans promesse. ' +
          'Refusé une fois la demande archivée par son porteur (promesse close, conservée ; ' +
          'masquer nom ou montant reste possible avec set_pledge).',
        inputSchema: {
          dossier: opportunityRef,
          instruction: userInstruction('retirer sa promesse'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ dossier, instruction }) =>
        run('withdraw_pledge', dossier, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          await this.refuseCopied(reader, dossier, instruction, 'Promesse non retirée')
          await serviceCall(() =>
            this.pledges.withdraw(reader, dossier, mcpOrigin(caller, instruction)),
          )
          return { message: 'Vous n’avez plus de promesse sur cette demande.' }
        }),
    )

    server.registerTool(
      'show_position_to_structure',
      {
        title: 'Montrer mon positionnement à une structure',
        description:
          'Investisseur, uniquement sur demande explicite de l’utilisateur : consentement à ' +
          'montrer votre positionnement sur cette demande (marque d’intérêt et promesse) à une ' +
          'structure dont le vivier vous l’apporte (opportunity.structures de get_opportunity), ' +
          'autorisée pour cette application. Ses conseillers et les administrateurs voient alors ' +
          'votre nom, votre organisation dans la structure, la date de votre marque et ' +
          'l’intention, le montant et la date de votre promesse — jamais votre commentaire, ni ce ' +
          'que vous montrez au porteur. Sans ce consentement, la structure ne voit rien, pas même ' +
          'un nombre. Retirable à tout moment (withdraw_position_disclosure).',
        inputSchema: {
          dossier: opportunityRef,
          workspace: z
            .string()
            .min(1)
            .describe('workspaceId (opportunity.structures) ou slug de la structure.'),
          instruction: userInstruction('montrer son positionnement à cette structure'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ dossier, workspace, instruction }) =>
        run('show_position_to_structure', dossier, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          const scope = await this.access.workspace(caller, workspace, trace)
          await this.refuseCopied(reader, dossier, instruction, 'Rien n’a été montré')
          const disclosure = await serviceCall(() =>
            this.positions.disclose(
              reader,
              dossier,
              scope.workspace.id,
              mcpOrigin(caller, instruction),
            ),
          )
          trace.dossierId = dossier
          return {
            message:
              `Positionnement montré à ${disclosure.workspace.name} : ses conseillers voient ` +
              'votre nom, votre organisation, votre marque d’intérêt et l’intention et le montant ' +
              'de votre promesse, jamais votre commentaire, tant que vous lisez la demande par son ' +
              'vivier.',
            disclosure: {
              disclosureId: disclosure.id,
              workspace: { workspaceId: disclosure.workspace.id, name: disclosure.workspace.name },
              disclosedAt: disclosure.disclosedAt,
            },
          }
        }),
    )

    server.registerTool(
      'withdraw_position_disclosure',
      {
        title: 'Ne plus montrer mon positionnement à une structure',
        description:
          'Investisseur, uniquement sur demande explicite de l’utilisateur : retire un ' +
          'consentement donné à une structure (disclosureId de list_my_positions ou ' +
          'get_opportunity), que vous lisiez encore la demande ou non ; même réponse pour un ' +
          'consentement déjà retiré ou inconnu. La structure ne voit plus rien de ce ' +
          'positionnement.',
        inputSchema: {
          disclosure: z.string().uuid().describe('disclosureId du consentement.'),
          instruction: userInstruction('ne plus montrer son positionnement à cette structure'),
        },
        annotations: CONSEQUENTIAL_ACTION,
      },
      ({ disclosure, instruction }) =>
        run('withdraw_position_disclosure', disclosure, async (trace) => {
          trace.instruction = instruction
          requireScope(caller, OAUTH_SCOPES.opportunitiesWrite)
          await serviceCall(() =>
            this.positions.withdrawDisclosure(reader, disclosure, mcpOrigin(caller, instruction)),
          )
          return { message: 'Ce consentement n’existe plus : la structure ne voit plus rien.' }
        }),
    )

    // A structure's follow-up: listed only to a connection allowed a workspace.
    if (caller.workspaceIds.length === 0) return

    server.registerTool(
      'list_investor_positions',
      {
        title: 'Positionnements des investisseurs (structure)',
        description:
          'Conseillers d’un workspace autorisé : chaque demande listée maintenant dans le vivier ' +
          'de la structure, avec les investisseurs qui ont choisi de lui montrer leur ' +
          'positionnement et la lisent encore par ce vivier — nom, organisation, date de la ' +
          'marque d’intérêt, intention, montant et date de la promesse ; jamais le commentaire. ' +
          'Rien des autres investisseurs, pas même un nombre. Ces positionnements restent à la ' +
          'structure : ne les recopiez pas dans un message destiné à l’entreprise ou à un autre ' +
          'investisseur.',
        inputSchema: {
          workspace: z.string().min(1).describe('workspaceId ou slug (list_workspaces).'),
        },
        annotations: { readOnlyHint: true },
      },
      ({ workspace }) =>
        run('list_investor_positions', workspace, async (trace) => {
          const scope = await this.access.workspace(caller, workspace, trace)
          const view = await serviceCall(() =>
            this.positions.forWorkspace(caller.user, scope.workspace.id),
          )
          return {
            workspace: { workspaceId: scope.workspace.id, name: scope.workspace.name },
            requests: view.items.map((item) => ({
              candidatureId: item.candidatureId,
              dossier: { dossierId: item.dossier.id, name: item.dossier.name },
              company: item.company,
              investors: item.investors.map((i) => ({
                investor: interestIdentityLabel(i.identity),
                disclosedAt: i.disclosedAt,
                interest: i.interest,
                pledge: i.pledge
                  ? { ...i.pledge, intentionLabel: PLEDGE_INTENTION_LABELS[i.pledge.intention] }
                  : null,
              })),
              pledgedEur: item.pledgedEur,
            })),
            nonCommitment: PLEDGE_NON_COMMITMENT,
          }
        }),
    )
  }

  // E04.09 for an investor: a request found word for word in what they read of the opportunity —
  // its title, presentation and answers, the names of its documents — was copied from the owner's
  // content, not written by the person. A request they no longer read has nothing to compare with.
  private async refuseCopied(
    reader: OpportunityReader,
    dossierId: string,
    instruction: string,
    refused: string,
  ): Promise<void> {
    const found = await this.opportunities.reachOne(reader, dossierId)
    if (!found) return
    const view = await this.shareLinks.recipientView(found.dossier, found.accessLevel)
    refuseInstructionFromContent(
      [
        view.dossier.name,
        view.dossier.summary,
        view.dossier.objective,
        view.dossier.description,
        ...view.answers.map((a) => a.value),
        ...view.documents.map((d) => d.filename),
      ],
      instruction,
      refused,
      'le contenu de la demande que vous lisez (titre, présentation, réponses, noms de documents)',
    )
  }
}

function codeOf(err: unknown): string | undefined {
  if (!(err instanceof ConflictException)) return undefined
  const body = err.getResponse() as { code?: unknown }
  return typeof body === 'object' && typeof body.code === 'string' ? body.code : undefined
}
