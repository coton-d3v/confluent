import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { createZodDto } from 'nestjs-zod'
import {
  adminDeletionQuerySchema,
  completeAccountDeletionSchema,
  declineAccountDeletionSchema,
  type AdminDeletionRequest,
} from '@confluent/shared'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AdminGuard } from '../auth/guards/admin.guard'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { AccountDeletionService } from './account-deletion.service'

class AdminDeletionQueryDto extends createZodDto(adminDeletionQuerySchema) {}
class CompleteAccountDeletionDto extends createZodDto(completeAccountDeletionSchema) {}
class DeclineAccountDeletionDto extends createZodDto(declineAccountDeletionSchema) {}

const uuid = new ParseUUIDPipe()

// ROADMAP E10.10: the administrators' queue of deletion requests and their decision.
@ApiTags('Admin · Suppressions de compte')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/deletion-requests')
export class AdminDeletionRequestsController {
  constructor(private readonly deletions: AccountDeletionService) {}

  @Get()
  @ApiOperation({
    summary: 'Demandes de suppression de compte',
    description:
      '`status=pending` (défaut) : la file, la plus ancienne d’abord, chacune avec ce que son ' +
      'traitement supprimerait et ce qui le bloque, lus maintenant. `status=decided` : les 100 ' +
      'dernières décisions (pseudonyme seul une fois le compte supprimé).',
  })
  @ApiOkResponse({ description: 'Les demandes.' })
  list(@Query() query: AdminDeletionQueryDto): Promise<AdminDeletionRequest[]> {
    return this.deletions.list(query.status)
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Traiter une demande : supprimer le compte',
    description:
      'Corps `{ "confirm": true }`. Une transaction : le compte et tout ce qu’il détient seul sont ' +
      'supprimés ; le journal garde les faits sans le nommer (voir la règle de ' +
      '`privacy.schema.ts`). Puis un email de confirmation à l’ancienne adresse (issue enregistrée) ' +
      'et le nettoyage du stockage. Journal `account_deleted`.',
  })
  @ApiOkResponse({ description: 'La demande, traitée.' })
  @ApiNotFoundResponse({ description: 'Demande inconnue.' })
  @ApiConflictResponse({
    description:
      '`DELETION_BLOCKED` (bloquants dans `details`), `DELETION_REQUEST_DECIDED` (déjà traitée ou ' +
      'retirée), `DELETION_REQUEST_OWN` (sa propre demande).',
  })
  complete(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() { confirm }: CompleteAccountDeletionDto,
  ): Promise<AdminDeletionRequest> {
    // `confirm`: always `true` once validated — the explicit confirmation is part of the contract.
    return confirm && this.deletions.complete(admin, id)
  }

  @Post(':id/decline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refuser une demande',
    description:
      'Corps `{ "note": "…" }` (1 à 1 000 caractères), lue par la personne dans « Mes données » ; ' +
      'elle est notifiée (dans le site et par email). Journal `account_deletion_declined`.',
  })
  @ApiOkResponse({ description: 'La demande, refusée.' })
  @ApiNotFoundResponse({ description: 'Demande inconnue.' })
  @ApiConflictResponse({ description: 'Déjà traitée ou retirée, ou sa propre demande.' })
  decline(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() body: DeclineAccountDeletionDto,
  ): Promise<AdminDeletionRequest> {
    return this.deletions.decline(admin, id, body.note)
  }
}
