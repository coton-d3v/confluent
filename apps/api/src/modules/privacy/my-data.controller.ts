import { Body, Controller, Delete, Get, HttpCode, Post, Res } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { createZodDto } from 'nestjs-zod'
import {
  EXPORT_LIMITS,
  requestAccountDeletionSchema,
  type MyDeletionRequest,
  type MyDeletionRequestState,
} from '@confluent/shared'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { AccountDeletionService } from './account-deletion.service'
import { ExportLimitReached, PersonalDataExportService } from './personal-data-export.service'

class RequestAccountDeletionDto extends createZodDto(requestAccountDeletionSchema) {}

// ROADMAP E10.10: the signed-in person's own data — its export and the deletion of their account.
// Always the account of the session, never an identifier taken from the client.
@ApiTags('Mes données')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('me')
export class MyDataController {
  constructor(
    private readonly exports: PersonalDataExportService,
    private readonly deletions: AccountDeletionService,
  ) {}

  @Get('export')
  @ApiOperation({
    summary: 'Télécharger mes données',
    description:
      'Un fichier JSON (`confluent.export.v1`, schéma `personalDataExportSchema`) : le compte, les ' +
      'entreprises détenues (sauf une entreprise préparée pour une structure) avec leurs demandes, ' +
      'réponses, documents (noms et versions, pas les fichiers), partages donnés et candidatures ; ' +
      'les partages reçus (nom de la demande seulement tant que le partage est actif) ; les ' +
      'positionnements tels que « Mes positionnements » les montre ; appartenances, notifications, ' +
      'applications connectées, entrées de journal du compte (action, date, application, ' +
      'adresse IP et navigateur du compte lui-même) et consultations. Jamais les données d’une ' +
      `autre personne. ${EXPORT_LIMITS.perAccount} téléchargements par heure et par compte ` +
      '(`429` + `Retry-After`), chacun journalisé (`personal_data_exported`).',
  })
  @ApiOkResponse({ description: 'Le fichier, en pièce jointe.' })
  @ApiTooManyRequestsResponse({ description: 'Limite horaire atteinte.' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    try {
      const document = await this.exports.export(user)
      const day = document.exportedAt.slice(0, 10)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="confluent-mes-donnees-${day}.json"`,
      )
      res.setHeader('Cache-Control', 'no-store')
      return JSON.stringify(document, null, 2)
    } catch (err) {
      if (err instanceof ExportLimitReached) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds))
      }
      throw err
    }
  }

  @Get('deletion-request')
  @ApiOperation({
    summary: 'Ma demande de suppression de compte',
    description:
      '`{ request }` : la dernière demande du compte (`null` sans demande) : statut, dates, note de refus ; en ' +
      'attente, ce que son traitement supprimerait et ce qui le bloque encore (`impact`).',
  })
  @ApiOkResponse({ description: '`{ request }`, la demande ou `null`.' })
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<MyDeletionRequestState> {
    return { request: await this.deletions.mine(user) }
  }

  @Post('deletion-request')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Demander la suppression de mon compte',
    description:
      'Corps `{ "confirm": true }`. Crée la demande, traitée ensuite par un administrateur ; le compte ' +
      'reste utilisable d’ici là. Déjà en attente : la même demande, rien de plus (double envoi). ' +
      'Journal `account_deletion_requested`.',
  })
  @ApiOkResponse({ description: 'La demande en attente.' })
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() { confirm }: RequestAccountDeletionDto,
  ): Promise<MyDeletionRequest> {
    // `confirm`: always `true` once validated — the explicit confirmation is part of the contract.
    return confirm && this.deletions.request(user)
  }

  @Delete('deletion-request')
  @ApiOperation({
    summary: 'Retirer ma demande de suppression',
    description: 'Tant qu’elle est en attente. Journal `account_deletion_cancelled`.',
  })
  @ApiOkResponse({ description: 'La demande, retirée.' })
  @ApiNotFoundResponse({ description: 'Aucune demande en attente (déjà traitée ou retirée).' })
  @ApiConflictResponse({ description: 'Jamais : un retrait concurrent répond `404`.' })
  cancel(@CurrentUser() user: AuthenticatedUser): Promise<MyDeletionRequest> {
    return this.deletions.cancel(user)
  }
}
