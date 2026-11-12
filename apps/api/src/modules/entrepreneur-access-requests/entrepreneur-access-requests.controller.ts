import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import {
  ENTREPRENEUR_ACCESS_REQUEST_LIMITS,
  ENTREPRENEUR_ACCESS_REQUEST_RECEIVED,
  createEntrepreneurAccessRequestSchema,
  decideEntrepreneurAccessRequestSchema,
  listEntrepreneurAccessRequestsQuerySchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  EntrepreneurAccessDecisionsService,
  type EntrepreneurAccessDecisionResult,
} from './entrepreneur-access-decisions.service'
import {
  ENTREPRENEUR_ACCESS_RATE_LIMITS,
  EntrepreneurAccessRequestsService,
  type EntrepreneurAccessFormView,
  type EntrepreneurAccessRequestView,
} from './entrepreneur-access-requests.service'

class CreateEntrepreneurAccessRequestDto extends createZodDto(
  createEntrepreneurAccessRequestSchema,
) {}
class DecideEntrepreneurAccessRequestDto extends createZodDto(
  decideEntrepreneurAccessRequestSchema,
) {}
class ListEntrepreneurAccessRequestsQueryDto extends createZodDto(
  listEntrepreneurAccessRequestsQuerySchema,
) {}

const NOT_FOUND =
  'Workspace inexistant, ou dont la page publique ne propose pas de candidater (page non publiée, ' +
  'bloc « Appel à candidater » masqué, aucun formulaire de candidature publié) : même réponse.'

// ROADMAP E09.05: an entrepreneur without an account asks a workspace for access to its candidature
// path — no account, no session. Rate-limited per network address (route) and, inside the service,
// per hour per network and per email address.
@ApiTags('Vitrine (public)')
@Public()
@ApiParam({ name: 'slug', description: 'Slug du workspace' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@Controller('public/workspaces/:slug')
export class PublicEntrepreneurAccessController {
  constructor(private readonly requests: EntrepreneurAccessRequestsService) {}

  @Get('entrepreneur-access-form')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Formulaire public de demande d’accès au parcours de candidature',
    description:
      'Proposé seulement quand la page publique du workspace montre comment candidater : page ' +
      'publiée, bloc `apply` affiché, formulaire de candidature publié. Nom du workspace et de son ' +
      'programme, et `formToken`, à renvoyer avec la demande (au plus tôt 3 s, au plus tard 12 h ' +
      'après ; propre à ce formulaire). Rate-limit 30 req/min/IP.',
  })
  @ApiOkResponse({ description: 'Formulaire.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit atteint.' })
  form(@Param('slug') slug: string): Promise<EntrepreneurAccessFormView> {
    return this.requests.form(slug)
  }

  @Post('entrepreneur-access-requests')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Demander l’accès au parcours de candidature (sans compte)',
    description:
      `\`name\` (≤ ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.name}), \`companyName\` (entreprise ou ` +
      `projet, ≤ ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.companyName}) et \`email\` obligatoires, ` +
      `\`message\` (texte simple, ≤ ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.message}) facultatif, ` +
      '`formToken` reçu avec le formulaire, et `website`, champ caché que seuls les robots ' +
      'remplissent. Enregistre une **demande en attente** (une seule par adresse et workspace : un ' +
      'nouvel envoi y est compté et conserve le reste) : **aucun compte, aucun droit, aucun email** ' +
      'avant la décision des gestionnaires du workspace — Confluent n’ouvre pas d’inscription ' +
      'générale. Réponse **identique** (`202`) que la demande soit enregistrée, comptée sur une ' +
      'demande en attente ou écartée (champ caché rempli, plus de ' +
      `${ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerAddress} envois par heure pour une adresse), et ` +
      'que l’adresse ait un compte ou non. Rate-limit 5 req/min/IP et ' +
      `${ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerNetwork} req/h/IP. Journal ` +
      '`entrepreneur_access_request_received` ou `entrepreneur_access_request_discarded`, sans nom, ' +
      'entreprise, adresse ni message.',
  })
  @ApiAcceptedResponse({
    description: 'Demande reçue (réponse identique dans tous les cas acceptés).',
    schema: { example: { message: ENTREPRENEUR_ACCESS_REQUEST_RECEIVED } },
  })
  @ApiBadRequestResponse({
    description:
      'Champ invalide, ou formulaire refusé (`details.reason` : `form_too_fast` envoyé moins de 3 s ' +
      'après son ouverture, `form_expired` jeton absent, invalide ou de plus de 12 h).',
  })
  @ApiTooManyRequestsResponse({ description: 'Trop de demandes depuis cette adresse réseau.' })
  @ApiServiceUnavailableResponse({
    description: `File du workspace pleine (${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.pendingPerWorkspace} demandes en attente).`,
  })
  async submit(
    @Param('slug') slug: string,
    @Body() body: CreateEntrepreneurAccessRequestDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.requests.submit(slug, body, { ip: req.ip ?? null })
    return { message: ENTREPRENEUR_ACCESS_REQUEST_RECEIVED }
  }
}

// The queue, read and decided by the workspace's managers.
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/entrepreneur-access-requests')
export class EntrepreneurAccessRequestsController {
  constructor(
    private readonly requests: EntrepreneurAccessRequestsService,
    private readonly decisions: EntrepreneurAccessDecisionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Demandes d’accès des porteurs de projet',
    description:
      'Les demandes envoyées depuis la page publique du workspace. `status=pending` (défaut) : en ' +
      'attente, de la plus ancienne à la plus récente ; `status=decided` : acceptées ou refusées, de ' +
      `la décision la plus récente à la plus ancienne (${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.decidedListed} ` +
      'au plus), avec la date, l’auteur, ce que l’acceptation a fait du compte et l’état de l’email. ' +
      'Lues par ses gestionnaires et les administrateurs de Confluent seulement ; une demande en ' +
      'attente ou refusée n’accorde aucun droit.',
  })
  @ApiOkResponse({ description: 'Demandes.' })
  list(
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Query() query: ListEntrepreneurAccessRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EntrepreneurAccessRequestView[]> {
    return this.requests.listForManagers(user, workspaceId, query)
  }

  @Post(':requestId/decision')
  @HttpCode(200)
  @ApiParam({ name: 'requestId', description: 'UUID de la demande' })
  @ApiOperation({
    summary: 'Accepter ou refuser une demande d’accès',
    description:
      '`decision` : `accepted` ou `refused`, définitive ; `version` lue avec la demande. ' +
      '**Accepter** crée le compte de l’adresse s’il n’existe pas, comme porteur de projet (non ' +
      'vérifié jusqu’à sa première connexion) ; un compte existant qui peut porter des projets est ' +
      'gardé tel quel ; un compte qui ne le peut pas (autre rôle, désactivé) n’est jamais modifié : ' +
      '`409`. Rien n’est créé à la place de la personne (ni entreprise, ni demande, ni candidature, ' +
      'ni appartenance au workspace) : un email l’invite, après l’enregistrement de la décision, à ' +
      'se connecter et à présenter sa demande au workspace (`invitationEmailSent` ; un échec ne ' +
      'l’annule pas). Le workspace doit encore recevoir des candidatures (`409` sinon). **Refuser** ' +
      'n’envoie rien et ne crée rien. Répéter la décision déjà prise répond `200` sans rien refaire ' +
      '(`invitationEmailSent: null`). Journal `entrepreneur_access_request_decided`, sans nom, ' +
      'entreprise, adresse ni message.',
  })
  @ApiOkResponse({ description: 'Demande décidée.' })
  @ApiBadRequestResponse({ description: 'Décision ou version invalide.' })
  @ApiConflictResponse({
    description:
      '`ENTREPRENEUR_ACCESS_REQUEST_CHANGED` (nouvel envoi depuis la lecture), ' +
      '`ENTREPRENEUR_ACCESS_REQUEST_DECIDED` (déjà décidée autrement), ' +
      '`ENTREPRENEUR_ACCESS_ACCOUNT_UNSUITABLE` (compte existant d’un autre rôle ou désactivé), ' +
      '`ENTREPRENEUR_ACCESS_CANDIDATURES_CLOSED` (plus de formulaire de candidature publié).',
  })
  decide(
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: DecideEntrepreneurAccessRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EntrepreneurAccessDecisionResult> {
    return this.decisions.decide(user, workspaceId, requestId, body)
  }
}
