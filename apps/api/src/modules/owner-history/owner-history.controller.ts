import { Controller, Get, Param, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { OWNER_HISTORY_PAGE_SIZE, ownerHistoryQuerySchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { READING_SESSION_DOC } from '../reading-sessions/reading-session-doc'
import { OwnerHistoryService, type OwnerHistoryView } from './owner-history.service'

class OwnerHistoryQueryDto extends createZodDto(ownerHistoryQuerySchema) {}

@ApiTags('Audit')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('dossiers/:id/history')
export class OwnerHistoryController {
  constructor(private readonly history: OwnerHistoryService) {}

  @Get()
  @ApiOperation({
    summary: '[Entrepreneur] Historique d’une demande',
    description:
      'Propriétaire seulement (E07.09). Une vue chronologique, la plus récente d’abord, par pages ' +
      `de ${OWNER_HISTORY_PAGE_SIZE} (\`page\` à partir de 1) : les **consultations** des partages ` +
      'directs (une par session de lecture, avec sa page, sa dernière activité et son temps actif), ' +
      'les **accès** (ouverts, niveau modifié, révoqués par le porteur ou par l’administration), les ' +
      '**interventions de l’administration** (réponse modifiée, reclassement après un changement des ' +
      'règles, document déposé) et les étapes de **la demande** (soumise, publiée, en brouillon, ' +
      'archivée, désarchivée, avec l’application IA qui l’a demandé le cas échéant). `filter` : ' +
      '`all` (par défaut), `consultations`, `access`, `administration`, `request`.\n\n' +
      'Lu dans le journal par une **liste fermée** d’actions (toute action non classée reste ' +
      'cachée) et décrit en français, jamais l’entrée brute : ni adresse IP ni navigateur des ' +
      'lecteurs, ni identifiant ou nom d’un administrateur ou d’un conseiller, ni ce qui a été ' +
      'demandé à une application, ni traces de sécurité, ni lectures, intérêts, promesses ou ' +
      'consentements des investisseurs d’un vivier (D05), ni suivi ou notes des structures. Le ' +
      'journal complet reste aux administrateurs (`GET /v1/admin/dossiers/:id/audit-log`).\n\n' +
      READING_SESSION_DOC,
  })
  @ApiParam({ name: 'id', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'Une page de l’historique, avec le total filtré.' })
  @ApiBadRequestResponse({ description: 'Paramètre inconnu ou invalide.' })
  @ApiNotFoundResponse({ description: 'Demande inexistante ou possédée par un autre compte.' })
  forOwner(
    @Param('id') id: string,
    @Query() query: OwnerHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OwnerHistoryView> {
    return this.history.forOwner(id, user.id, query)
  }
}
