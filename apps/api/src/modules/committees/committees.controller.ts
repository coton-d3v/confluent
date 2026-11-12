import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  changeCommitteeStatusSchema,
  createCommitteeSchema,
  updateCommitteeSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { CommitteeFollowUpService, type CommitteeProgressView } from './committee-follow-up.service'
import { CommitteesService, type CommitteeView } from './committees.service'

class CreateCommitteeDto extends createZodDto(createCommitteeSchema) {}
class UpdateCommitteeDto extends createZodDto(updateCommitteeSchema) {}
class ChangeCommitteeStatusDto extends createZodDto(changeCommitteeStatusSchema) {}

const uuid = new ParseUUIDPipe()

const NOT_FOUND =
  'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou comité ' +
  'inexistant dans ce workspace.'

const VIEW =
  '`date` (AAAA-MM-JJ) et `time` (HH:MM) : l’heure locale saisie, dans le fuseau IANA `timeZone` ; ' +
  '`startsAt` : l’instant qu’elles désignent. `location` (lieu) et `meetingUrl` (lien https) ' +
  'facultatifs ; `status` `planned` (programmé), `held` (tenu) ou `cancelled` (annulé) ; ' +
  '`internalNotes` : notes internes, lues par les seuls conseillers du workspace et jamais ' +
  'diffusées ; `sharedInfo` : informations destinées aux candidats et aux investisseurs du comité ' +
  '(les porteurs les lisent depuis leur candidature, avec le lien une fois leur participation ' +
  'retenue ; les participants acceptés depuis le workspace, lien compris) ; `version` : à renvoyer ' +
  'pour modifier le comité.'

// The committees a workspace organises (ROADMAP E08.01), as those who follow its candidatures read
// them. The workspace is checked before anything else (guard, `404` outside it), then the service
// applies the read rule (`403` for an investisseur).
@ApiTags('Comités')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/committees')
export class CommitteesController {
  constructor(
    private readonly committees: CommitteesService,
    private readonly followUp: CommitteeFollowUpService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Comités du workspace',
    description:
      'Tous les comités du workspace, annulés et tenus compris, du plus ancien au plus récent. ' +
      VIEW +
      ' Lus par les conseillers actifs et les administrateurs de Confluent.',
  })
  @ApiOkResponse({ description: 'Comités.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeView[]> {
    return this.committees.list(user, workspaceId)
  }

  // Declared before `:committeeId`, which would take `progress` for an identifier.
  @Get('progress')
  @ApiOperation({
    summary: 'Avancement des comités du workspace',
    description:
      'Pour chaque comité (même ordre que la liste) : le nombre de participations de demandes par ' +
      'statut (`applied`, `proposed`, `accepted`, `refused`, `withdrawn`) et le nombre de ' +
      'participants — demandes de participation acceptées dont le compte est encore membre actif ' +
      '(`accepted`), ou en attente de décision (`pending`). Des nombres seulement : ni nom, ni ' +
      'adresse. Lu par les conseillers actifs et les administrateurs de Confluent.',
  })
  @ApiOkResponse({ description: 'Avancement de chaque comité.' })
  progress(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeProgressView[]> {
    return this.followUp.progress(user, workspaceId)
  }

  @Get(':committeeId')
  @ApiParam({ name: 'committeeId', description: 'UUID du comité' })
  @ApiOperation({ summary: 'Un comité du workspace', description: VIEW })
  @ApiOkResponse({ description: 'Comité.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeView> {
    return this.committees.get(user, workspaceId, committeeId)
  }
}

// Organising them: the workspace's managers and Confluent administrators (`canManageWorkspace`).
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/committees')
export class AdminCommitteesController {
  constructor(private readonly committees: CommitteesService) {}

  @Post()
  @ApiOperation({
    summary: 'Programmer un comité',
    description:
      '`name`, `date` (AAAA-MM-JJ), `time` (HH:MM) et `timeZone` (fuseau IANA, par exemple ' +
      '`Europe/Paris`) obligatoires ; `location` (une ligne), `meetingUrl` (lien https, sans ' +
      'identifiants), `internalNotes` (texte simple, réservé aux conseillers du workspace) et ' +
      '`sharedInfo` (texte simple, destiné aux candidats et aux investisseurs) facultatifs. Une heure ' +
      'qui n’existe pas ou qui existe deux fois ce jour-là dans ce fuseau (changement d’heure) est ' +
      'refusée. Le comité est créé au statut « programmé ». Au plus 500 comités par workspace.',
  })
  @ApiCreatedResponse({ description: 'Comité créé.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou heure ambiguë ou inexistante.' })
  @ApiConflictResponse({ description: 'Nombre maximal de comités atteint.' })
  create(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: CreateCommitteeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeView> {
    return this.committees.create(user, workspaceId, body)
  }

  @Put(':committeeId')
  @ApiParam({ name: 'committeeId', description: 'UUID du comité' })
  @ApiOperation({
    summary: 'Modifier un comité',
    description:
      'Tous les champs de la création, plus `version` : celle du comité lu. Un champ facultatif ' +
      'absent ou vide est effacé, sauf `sharedInfo` : absent, il est conservé tel quel ; `null` ou ' +
      'vide l’efface. Seul un comité programmé se modifie. Les mêmes valeurs ne changent rien (ni ' +
      'version, ni journal).',
  })
  @ApiOkResponse({ description: 'Comité modifié.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou heure ambiguë ou inexistante.' })
  @ApiConflictResponse({
    description: 'Comité modifié entre-temps (`version`), ou annulé ou tenu.',
  })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @Body() body: UpdateCommitteeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeView> {
    return this.committees.update(user, workspaceId, committeeId, body)
  }

  @Post(':committeeId/status')
  @HttpCode(200)
  @ApiParam({ name: 'committeeId', description: 'UUID du comité' })
  @ApiOperation({
    summary: 'Annuler un comité, le marquer tenu ou le remettre au statut programmé',
    description:
      '`status` et `version` (celle du comité lu). Programmé → annulé, ou tenu une fois son heure ' +
      'passée ; annulé ou tenu → programmé. Annuler ne supprime rien : le comité reste lisible.',
  })
  @ApiOkResponse({ description: 'Statut changé.' })
  @ApiBadRequestResponse({ description: 'Statut inconnu.' })
  @ApiConflictResponse({
    description:
      'Comité modifié entre-temps, transition impossible, ou comité pas encore commencé.',
  })
  changeStatus(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @Body() body: ChangeCommitteeStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeView> {
    return this.committees.changeStatus(user, workspaceId, committeeId, body)
  }
}
