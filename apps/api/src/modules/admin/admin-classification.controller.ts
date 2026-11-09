import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { ClassificationRule } from '@prisma/client'
import {
  applyReclassificationSchema,
  createClassificationRuleSchema,
  updateClassificationRuleSchema,
  type ClassificationCoverage,
  type ReclassificationPreview,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AdminGuard } from '../auth/guards/admin.guard'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ClassificationRulesService } from '../classification/classification-rules.service'
import { ReclassificationService } from '../classification/reclassification.service'

class CreateRuleDto extends createZodDto(createClassificationRuleSchema) {}
class UpdateRuleDto extends createZodDto(updateClassificationRuleSchema) {}
class ApplyReclassificationDto extends createZodDto(applyReclassificationSchema) {}

// Classification taxonomy and rules (ROADMAP E03.12).
@ApiTags('Admin · Classification')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/classification')
export class AdminClassificationController {
  constructor(
    private readonly rules: ClassificationRulesService,
    private readonly reclassification: ReclassificationService,
  ) {}

  @Get('rules')
  @ApiOperation({
    summary: 'Règles de classification',
    description:
      'Une règle relie une clé de champ (et, selon la dimension, une clé de choix) à une valeur. ' +
      'Les dimensions et leurs valeurs possibles sont définies dans `@confluent/shared`.',
  })
  list(): Promise<ClassificationRule[]> {
    return this.rules.list()
  }

  @Post('rules')
  @ApiOperation({ summary: 'Ajouter une règle (sans effet sur les dossiers déjà classés)' })
  @ApiConflictResponse({ description: 'Règle déjà existante pour ce champ et ce choix.' })
  create(@Body() body: CreateRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.create(body, user.id)
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: 'Modifier la valeur ou la position d’une règle' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rules.update(id, body, user.id)
  }

  @Delete('rules/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer une règle' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.remove(id, user.id)
  }

  @Get('coverage')
  @ApiOperation({
    summary: 'Contrôle des règles face au formulaire des dossiers',
    description:
      'Pour la version publiée et le brouillon du formulaire des dossiers : champs ou choix lus par ' +
      'une règle mais absents, et choix qui ne donnent aucune valeur.',
  })
  coverage(): Promise<ClassificationCoverage> {
    return this.rules.coverage()
  }

  @Get('reclassification')
  @ApiOperation({
    summary: 'Aperçu d’un reclassement',
    description:
      'Ce que les règles actuelles changeraient sur les dossiers soumis, sans rien écrire. Les ' +
      'dossiers ne sont jamais reclassés automatiquement quand les règles changent.',
  })
  preview(): Promise<ReclassificationPreview> {
    return this.reclassification.preview()
  }

  @Post('reclassification')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reclasser les dossiers soumis',
    description:
      'Applique les règles de l’aperçu désigné par `rulesRevision` ; chaque dossier modifié est ' +
      'tracé avec les valeurs avant/après effectivement écrites. `409` si les règles ont changé ' +
      'depuis l’aperçu : rien n’est écrit.',
  })
  @ApiConflictResponse({
    description: 'Règles modifiées depuis l’aperçu (`CLASSIFICATION_RULES_CHANGED`).',
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApplyReclassificationDto,
  ): Promise<ReclassificationPreview> {
    return this.reclassification.apply(user.id, body.rulesRevision)
  }
}
