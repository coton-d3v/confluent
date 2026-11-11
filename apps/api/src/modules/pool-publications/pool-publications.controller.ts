import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { publishToPoolSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import type { CandidatureView } from '../candidatures/candidatures.service'
import { PoolPublicationsService } from './pool-publications.service'

class PublishToPoolDto extends createZodDto(publishToPoolSchema) {}

const uuid = new ParseUUIDPipe()

// What the pool will show, said once for both routes.
const POOL_SCOPE =
  'Les investisseurs du workspace liront la demande exactement comme un destinataire de lien ' +
  'nominatif au même niveau (présentation, réponses du profil, classification et documents ' +
  'choisis que ce niveau permet de lire), rien d’autre : ni les réponses au formulaire de la ' +
  'structure, ni le plan de financement, les dispositifs, le parcours, le statut ou les notes. ' +
  'La publication est propre à cette candidature : elle ne touche ni les autres workspaces, ni ' +
  'les partages, ni la candidature, ni la publication de la demande.'

// ROADMAP E07.02: the owner of a financing request publishes it in the pool (« vivier ») of a
// workspace it is presented to, and withdraws it. The candidature names the workspace; `404` alike
// for another account's candidature (a conseiller's or an administrator's included) and an unknown
// one. The workspace's conseillers read where the publication stands on the candidatures they
// receive (`poolPublication`); its investors read the pool from E07.03.
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
@Controller('candidatures/:candidatureId/pool-publication')
export class PoolPublicationsController {
  constructor(private readonly pool: PoolPublicationsService) {}

  @Put()
  @ApiOperation({
    summary: 'Publier la demande dans le vivier de la structure',
    description:
      'Consentement explicite du porteur de projet (`consent: true`) au niveau qu’il choisit ' +
      '(`accessLevel`, aucun par défaut) : publie la demande dans le vivier du workspace de la ' +
      'candidature, l’y publie de nouveau après un retrait, ou change le niveau d’une publication ' +
      'active ; daté et journalisé (`pool_publication_published`). Publier ou élargir exige la ' +
      'candidature envoyée (`409` `CANDIDATURE_NOT_SENT`), la demande publiée (`409` ' +
      '`DOSSIER_NOT_PUBLISHED`, `DOSSIER_ARCHIVED`) et son suivi non clos dans ce workspace (`409` ' +
      '`FINANCING_CLOSED`) ; restreindre le niveau reste toujours possible. Le même niveau ne ' +
      'change rien. Une publication est en pause tant que la demande n’est plus publiée ou que son ' +
      'suivi est clos, et reprend ensuite ; archiver la demande la retire. ' +
      POOL_SCOPE,
  })
  @ApiOkResponse({ description: 'Candidature, avec sa publication au vivier (`poolPublication`).' })
  @ApiBadRequestResponse({ description: 'Niveau inconnu, ou consentement absent.' })
  @ApiConflictResponse({
    description:
      'Candidature non envoyée, demande non publiée ou archivée, suivi clos, ou entreprise en ' +
      'préparation par un conseiller.',
  })
  publish(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: PublishToPoolDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.pool.publish(candidatureId, user.id, body)
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retirer la demande du vivier de la structure',
    description:
      'Retire la publication de ce seul workspace, effective à la requête suivante des ' +
      'investisseurs ; journalisé (`pool_publication_withdrawn`). Rien ne change pour une ' +
      'publication déjà retirée ou jamais faite. ' +
      POOL_SCOPE,
  })
  @ApiOkResponse({ description: 'Candidature, avec sa publication au vivier (`poolPublication`).' })
  withdraw(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.pool.withdraw(candidatureId, user.id)
  }
}
