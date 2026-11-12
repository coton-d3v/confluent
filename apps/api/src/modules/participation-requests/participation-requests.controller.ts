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
  PARTICIPATION_REQUEST_RECEIVED,
  createParticipationRequestSchema,
  decideParticipationRequestSchema,
  listParticipationRequestsQuerySchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  ParticipationDecisionsService,
  type ParticipationDecisionResult,
} from './participation-decisions.service'
import {
  PARTICIPATION_RATE_LIMITS,
  ParticipationRequestsService,
  type ParticipationFormView,
  type ParticipationRequestView,
} from './participation-requests.service'

class CreateParticipationRequestDto extends createZodDto(createParticipationRequestSchema) {}
class DecideParticipationRequestDto extends createZodDto(decideParticipationRequestSchema) {}
class ListParticipationRequestsQueryDto extends createZodDto(
  listParticipationRequestsQuerySchema,
) {}

const NOT_FOUND =
  'Workspace inexistant, ou qui n’offre aucune session aux demandes de participation (même réponse).'

// ROADMAP E08.04: a workspace's public participation form — no account, no session. Rate-limited per
// network address (route) and, inside the service, per hour per network and per email address.
@ApiTags('Participation (public)')
@Public()
@ApiParam({ name: 'slug', description: 'Slug du workspace' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@Controller('public/workspaces/:slug')
export class PublicParticipationController {
  constructor(private readonly requests: ParticipationRequestsService) {}

  @Get('participation-form')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Formulaire public de demande de participation aux comités',
    description:
      'Nom du workspace et de son programme, sessions offertes — les comités que ses gestionnaires ' +
      'ont ouverts aux demandes, programmés et pas encore commencés — avec leur seul nom, date, ' +
      'heure et fuseau (`toPublicCommittee` : ni lieu, ni lien, ni informations diffusées, ni notes ' +
      'internes), et `formToken`, à renvoyer avec la demande (au plus tôt 3 s, au plus tard 12 h ' +
      'après). Rate-limit 30 req/min/IP.',
  })
  @ApiOkResponse({ description: 'Formulaire.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit atteint.' })
  form(@Param('slug') slug: string): Promise<ParticipationFormView> {
    return this.requests.form(slug)
  }

  @Post('participation-requests')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Demander à participer à des sessions (sans compte)',
    description:
      '`name`, `email` et `committeeIds` (1 à 20 sessions offertes) obligatoires, `organization` et ' +
      '`message` (texte simple, ≤ 2 000) facultatifs, `formToken` reçu avec le formulaire, et ' +
      '`website`, champ caché que seuls les robots remplissent. Enregistre une **demande en ' +
      'attente** (une seule par adresse et workspace : une nouvelle demande y ajoute ses sessions ' +
      'et conserve le reste) : aucun compte, aucune appartenance, aucun droit, aucun email envoyé ' +
      'avant sa validation (E08.05). Réponse **identique** (`202`) que la demande soit ' +
      'enregistrée, ajoutée à une demande en attente ou écartée (champ caché rempli, plus de ' +
      `${PARTICIPATION_RATE_LIMITS.perHourPerAddress} demandes par heure pour une adresse) : elle ` +
      'ne dit jamais si une adresse a déjà demandé. Rate-limit 5 req/min/IP et ' +
      `${PARTICIPATION_RATE_LIMITS.perHourPerNetwork} req/h/IP. Journal ` +
      '`participation_request_received` ou `participation_request_discarded`, sans nom, adresse ' +
      'ni message.',
  })
  @ApiAcceptedResponse({
    description: 'Demande reçue (réponse identique dans tous les cas acceptés).',
    schema: { example: { message: PARTICIPATION_REQUEST_RECEIVED } },
  })
  @ApiBadRequestResponse({
    description:
      'Champ invalide, ou formulaire refusé (`details.reason` : `form_too_fast` envoyé moins de 3 s ' +
      'après son ouverture, `form_expired` jeton absent, invalide ou de plus de 12 h).',
  })
  @ApiConflictResponse({
    description:
      'Une session choisie n’est pas (ou plus) offerte (`details.committeeIds` : celles envoyées).',
  })
  @ApiTooManyRequestsResponse({ description: 'Trop de demandes depuis cette adresse réseau.' })
  @ApiServiceUnavailableResponse({
    description: 'File du workspace pleine (1 000 demandes en attente).',
  })
  async submit(
    @Param('slug') slug: string,
    @Body() body: CreateParticipationRequestDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.requests.submit(slug, body, { ip: req.ip ?? null })
    return { message: PARTICIPATION_REQUEST_RECEIVED }
  }
}

// The queue, read and decided by the workspace's managers (E08.05).
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/participation-requests')
export class ParticipationRequestsController {
  constructor(
    private readonly requests: ParticipationRequestsService,
    private readonly decisions: ParticipationDecisionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Demandes de participation du workspace',
    description:
      'Les demandes envoyées depuis le formulaire public du workspace, avec les sessions demandées. ' +
      '`status=pending` (défaut) : en attente, de la plus ancienne à la plus récente ; ' +
      '`status=decided` : acceptées ou refusées, de la décision la plus récente à la plus ancienne ' +
      '(200 au plus), avec la date, l’auteur, ce que l’acceptation a fait du compte et l’état de ' +
      'l’email. `committeeId` : seulement celles qui demandent ce comité. Lues par ses ' +
      'gestionnaires et les administrateurs de Confluent ; une demande en attente ou refusée ' +
      'n’accorde aucun droit.',
  })
  @ApiOkResponse({ description: 'Demandes.' })
  list(
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Query() query: ListParticipationRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ParticipationRequestView[]> {
    return this.requests.listForManagers(user, workspaceId, query)
  }

  @Post(':requestId/decision')
  @HttpCode(200)
  @ApiParam({ name: 'requestId', description: 'UUID de la demande' })
  @ApiOperation({
    summary: 'Accepter ou refuser une demande de participation',
    description:
      '`decision` : `accepted` ou `refused`, définitive ; `version` lue avec la demande. ' +
      '**Accepter** crée le compte de l’adresse s’il n’existe pas (non vérifié jusqu’à sa première ' +
      'connexion) et l’ajoute au workspace comme investisseur, avec l’organisation indiquée ; un ' +
      'membre actif garde son appartenance telle quelle (jamais élargie ni réduite) ; un membre ' +
      'désactivé n’est pas réactivé (`409`). Puis un email prévient la personne, après ' +
      'l’enregistrement de la décision (`invitationEmailSent` ; un échec ne l’annule pas). ' +
      '**Refuser** n’envoie rien et ne crée rien. Les sessions demandées restent enregistrées ; ' +
      'l’acceptation n’ouvre l’accès à aucun comité. Répéter la décision déjà prise répond ' +
      '`200` sans rien refaire (`invitationEmailSent: null`). Journal ' +
      '`participation_request_decided`, sans nom, adresse ni message.',
  })
  @ApiOkResponse({ description: 'Demande décidée.' })
  @ApiBadRequestResponse({ description: 'Décision ou version invalide.' })
  @ApiConflictResponse({
    description:
      '`PARTICIPATION_REQUEST_CHANGED` (nouvel envoi depuis la lecture), ' +
      '`PARTICIPATION_REQUEST_DECIDED` (déjà décidée autrement), ' +
      '`PARTICIPATION_MEMBER_DEACTIVATED` (adresse d’un membre désactivé).',
  })
  decide(
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: DecideParticipationRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ParticipationDecisionResult> {
    return this.decisions.decide(user, workspaceId, requestId, body)
  }
}
