import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { createQuestionnaireVersionSchema, patchQuestionnaireFieldSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { AdminGuard } from '../auth/guards/admin.guard'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'

class CreateVersionDto extends createZodDto(createQuestionnaireVersionSchema) {}
class PatchFieldDto extends createZodDto(patchQuestionnaireFieldSchema) {}

@ApiTags('Admin · Questionnaire')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
// Deprecated by the form builder (`/v1/admin/forms`); removed once the admin web uses it.
@Controller('admin/questionnaire/versions')
export class AdminQuestionnaireController {
  constructor(private readonly service: QuestionnairesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister toutes les versions du questionnaire',
    deprecated: true,
    description:
      'Retourne tous les `questionnaire_versions` (published ou non), tri par `version` desc.',
  })
  @ApiOkResponse({ description: 'Liste des versions.' })
  listVersions() {
    return this.service.listVersions()
  }

  @Post()
  @ApiOperation({
    summary: 'Publier une nouvelle version du questionnaire (FR13, FR14, FR15)',
    deprecated: true,
    description:
      'Crée et publie une nouvelle version avec ses `fields` ; la version publiée précédente passe ' +
      '`archived` dans la même transaction. **Les dossiers existants gardent leur version** : ils ne ' +
      'sont jamais rattachés à la nouvelle (FR14). Chaque champ porte une `key` technique (snake_case, ' +
      'unique dans la version, dérivée du libellé si absente) et, pour une liste, des `choices` ' +
      '`{ key?, label }` (clé dérivée du libellé si absente). Les réponses stockent la clé du choix et la ' +
      'classification lit les clés : pour renommer un champ ou un choix sans changer leur sens, reprendre ' +
      'leurs `key` de la version précédente. `minAccessLevel` (public | partiel | complet, défaut ' +
      '`complet`) fixe le niveau de partage minimal pour qu’un financeur lise la réponse.',
  })
  @ApiCreatedResponse({ description: 'Version créée et publiée.' })
  create(@Body() body: CreateVersionDto) {
    return this.service.createVersion(body.fields)
  }

  @Patch(':versionId/fields/:fieldId')
  @ApiOperation({
    summary: 'Patcher un champ d’une version spécifique',
    deprecated: true,
    description:
      'Met à jour `label`, `fieldType`, ou `required` d’un champ. Scope strict à la version passée en URL — ' +
      '404 si le `fieldId` n’appartient pas à `versionId`. Les autres versions restent intactes.',
  })
  @ApiParam({ name: 'versionId', description: 'UUID de la version' })
  @ApiParam({ name: 'fieldId', description: 'UUID du champ' })
  @ApiOkResponse({ description: 'Champ mis à jour.' })
  @ApiNotFoundResponse({ description: 'Champ inexistant ou appartenant à une autre version.' })
  patchField(
    @Param('versionId') versionId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: PatchFieldDto,
  ) {
    return this.service.updateField(versionId, fieldId, body)
  }
}
