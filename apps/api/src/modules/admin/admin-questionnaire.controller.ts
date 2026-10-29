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
import { fieldKeySchema, hasUniqueKeys } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { AdminGuard } from '../auth/guards/admin.guard'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'

const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'email',
  'number',
  'date',
  'select',
  'checkbox',
  'file',
])

const fieldInputSchema = z.object({
  section: z.string().min(1).max(200),
  key: fieldKeySchema.optional(),
  label: z.string().min(1).max(500),
  fieldType: fieldTypeSchema,
  options: z.array(z.string().min(1).max(500)).max(200).optional(),
  required: z.boolean().default(false),
  orderIndex: z.number().int().min(0),
})

const createVersionSchema = z.object({
  fields: z.array(fieldInputSchema).min(1).max(500).refine(hasUniqueKeys, {
    message: 'Each field key must be unique within a version.',
  }),
})

const patchFieldSchema = z
  .object({
    label: z.string().min(1).max(500).optional(),
    fieldType: fieldTypeSchema.optional(),
    required: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided.',
  })

class CreateVersionDto extends createZodDto(createVersionSchema) {}
class PatchFieldDto extends createZodDto(patchFieldSchema) {}

@ApiTags('Admin · Questionnaire')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/questionnaire/versions')
export class AdminQuestionnaireController {
  constructor(private readonly service: QuestionnairesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister toutes les versions du questionnaire',
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
    description:
      'Crée une nouvelle version avec ses `fields`. Transaction : marque la version précédente `isPublished=false` ' +
      'et la nouvelle `isPublished=true`. **Les dossiers existants gardent leur version snapshot** — ils ne sont ' +
      'jamais re-bindés (FR14 immuabilité). Chaque champ peut porter une `key` technique (snake_case, unique ' +
      'dans la version) lue par la classification : reprendre les `key` et `options` de la version précédente ' +
      'pour que la classification continue de fonctionner.',
  })
  @ApiCreatedResponse({ description: 'Version créée et publiée.' })
  create(@Body() body: CreateVersionDto) {
    return this.service.createVersion(body.fields)
  }

  @Patch(':versionId/fields/:fieldId')
  @ApiOperation({
    summary: 'Patcher un champ d’une version spécifique',
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
