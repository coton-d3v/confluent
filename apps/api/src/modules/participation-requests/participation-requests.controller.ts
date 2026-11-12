import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { PARTICIPATION_REQUEST_RECEIVED, createParticipationRequestSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  PARTICIPATION_RATE_LIMITS,
  ParticipationRequestsService,
  type ParticipationFormView,
  type ParticipationRequestView,
} from './participation-requests.service'

class CreateParticipationRequestDto extends createZodDto(createParticipationRequestSchema) {}

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

// The queue, read by the workspace's managers until E08.05 lets them process it.
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
  constructor(private readonly requests: ParticipationRequestsService) {}

  @Get()
  @ApiOperation({
    summary: 'Demandes de participation en attente',
    description:
      'Les demandes envoyées depuis le formulaire public du workspace, en attente de traitement ' +
      '(E08.05), de la plus ancienne à la plus récente, avec les sessions demandées. Lues par ses ' +
      'gestionnaires et les administrateurs de Confluent ; aucune n’accorde de droit.',
  })
  @ApiOkResponse({ description: 'Demandes en attente.' })
  list(
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ParticipationRequestView[]> {
    return this.requests.listForManagers(user, workspaceId)
  }
}
