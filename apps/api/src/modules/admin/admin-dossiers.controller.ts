import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import {
  ACCEPTED_DOCUMENT_FORMATS_LABEL,
  DOCUMENT_TYPES,
  adminDossierListQuerySchema,
  adminDossierLookupQuerySchema,
  upsertAnswersSchema,
  type UploadedDocument,
} from '@confluent/shared'
import { AdminGuard } from '../auth/guards/admin.guard'
import type { DocumentGroup } from '../documents/documents.service'
import {
  UPLOAD_OPTIONS,
  documentFieldIdField,
  documentTypeField,
  requireFile,
  versionResponse,
  type MulterFile,
} from '../documents/upload-request'
import { UploadSizeGuard } from '../documents/upload-size.guard'
import { UploadSlotsInterceptor } from '../documents/upload-slots.interceptor'
import {
  AdminDossiersService,
  type AdminDossierList,
  type AdminDossierListItem,
} from './admin-dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class UpsertAnswersDto extends createZodDto(upsertAnswersSchema) {}
class AdminDossierListQueryDto extends createZodDto(adminDossierListQuerySchema) {}
class AdminDossierLookupQueryDto extends createZodDto(adminDossierLookupQuerySchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Admin · Dossiers')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/dossiers')
export class AdminDossiersController {
  constructor(private readonly service: AdminDossiersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister ou rechercher TOUS les dossiers (paginé)',
    description:
      'Retourne les dossiers de **toute la plateforme** — aucun filtre ownership — les plus récents ' +
      'd’abord (création puis identifiant : une page ne répète ni ne saute aucun dossier). Pagination ' +
      '`page` (1 à 10 000, défaut 1) / `pageSize` (1 à 100, défaut 20) ; `400` hors bornes. ' +
      'Recherche facultative `q` (200 caractères au plus, espaces retirés, vide = tous) côté serveur, ' +
      'au-delà de toute page (E10.05) : valeur entière pour le slug, l’identifiant du dossier ou de ' +
      'son entreprise et l’email du porteur (casse ignorée) ; partie du texte pour le titre de la ' +
      'demande ou le nom de l’entreprise (casse ignorée). `exactMatch` : le dossier dont le slug ou ' +
      'l’identifiant vaut exactement `q` (« aller à »), `null` sinon. Inclut `ownerEmail`, ' +
      '`companyName` et `activeShareLinksCount`.',
  })
  @ApiOkResponse({
    description: 'Page de dossiers + métadonnées (`total`, `page`, `pageSize`, `q`, `exactMatch`).',
  })
  @ApiBadRequestResponse({ description: 'Page, taille de page ou recherche hors bornes.' })
  list(@Query() query: AdminDossierListQueryDto): Promise<AdminDossierList> {
    return this.service.list(query)
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Aller à un dossier par slug ou identifiant exact (E10.05)',
    description:
      'Le dossier dont le slug (casse ignorée) ou l’identifiant vaut exactement `ref` — jamais une ' +
      'partie —, au format d’une ligne de la liste. Sert l’adresse `/admin/dossiers/:ref` du site : ' +
      'un slug change avec le titre, l’identifiant reste.',
  })
  @ApiOkResponse({ description: 'Ligne de la liste admin du dossier.' })
  @ApiBadRequestResponse({ description: '`ref` absent ou trop long.' })
  @ApiNotFoundResponse({ description: 'Aucun dossier n’a ce slug ni cet identifiant.' })
  lookup(@Query() query: AdminDossierLookupQueryDto): Promise<AdminDossierListItem> {
    return this.service.lookup(query.ref)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail admin d’un dossier',
    description:
      'Retourne le dossier avec relations complètes : `answers`, `shareLinks`, `documents`, `ownerEmail`, ' +
      '`company` (entreprise du dossier, E05.04). ' +
      'Plus riche que la vue entrepreneur `GET /v1/dossiers/:id`.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Dossier complet (scope admin).' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  detail(@Param('id') id: string) {
    return this.service.detail(id)
  }

  @Patch(':id/answers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin — éditer les réponses d’un dossier',
    description:
      'Upsert des réponses + trace **par champ modifié** dans `audit_log`: `action_type: admin_edited_field`, ' +
      '`metadata: { fieldId, oldValue, newValue }`. Traçabilité totale pour FR24 / FR35.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Réponses mises à jour. Body : `{ status: "ok" }`.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  async editAnswers(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpsertAnswersDto,
  ): Promise<{ status: 'ok' }> {
    await this.service.editAnswers(id, currentUser(req).id, body.answers)
    return { status: 'ok' }
  }

  @Get(':id/documents')
  @ApiOperation({
    summary: 'Admin — bibliothèque de documents d’un dossier (E10.05)',
    description:
      'Même liste que celle du propriétaire (`GET /v1/dossiers/:id/documents`) : toute la ' +
      'bibliothèque de l’entreprise du dossier, chaque document avec son type, ses versions (la plus ' +
      'récente d’abord), leur disponibilité et un lien de téléchargement signé 15 min, et ' +
      '`selection` (comment ce dossier le présente à ses partages, `null` s’il ne le présente pas).',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Documents groupés par nom.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  documents(@Param('id') id: string): Promise<DocumentGroup[]> {
    return this.service.listDocuments(id)
  }

  @Post(':id/documents')
  @UseGuards(UploadSizeGuard)
  @UseInterceptors(UploadSlotsInterceptor, FileInterceptor('file', UPLOAD_OPTIONS))
  @ApiOperation({
    summary: 'Admin — déposer ou remplacer un document (E10.05)',
    description:
      'Même dépôt que celui du propriétaire (`POST /v1/dossiers/:id/documents`), dans la ' +
      'bibliothèque de l’entreprise du dossier : multipart `file`, max **20 Mo** (`413`, `411` sans ' +
      `taille annoncée), formats reconnus d’après le contenu : ${ACCEPTED_DOCUMENT_FORMATS_LABEL} ` +
      '(`415` sinon) ; `fieldId` et `type` facultatifs, comme pour le propriétaire. Un fichier du ' +
      'même nom pour la même question **remplace** le document : nouvelle version, la plus récente, ' +
      'les précédentes restent ; sinon un nouveau document, **que le dossier ne présente pas** à ses ' +
      'partages tant que le propriétaire ne l’a pas choisi. Journalisé dans la même transaction ' +
      '(`admin_uploaded_document` : document, version, nom, nouveau ou remplacé) ; le propriétaire ' +
      'le lit dans l’historique de sa demande (« déposé » ou « remplacé par l’administration »). ' +
      'L’objet stocké est supprimé si l’enregistrement échoue.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        fieldId: { type: 'string', format: 'uuid' },
        type: { type: 'string', enum: [...DOCUMENT_TYPES] },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({
    description: 'Version créée, au même format que le dépôt du propriétaire.',
  })
  @ApiBadRequestResponse({ description: 'Fichier absent, `fieldId` invalide ou `type` inconnu.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  @ApiPayloadTooLargeResponse({ description: 'Fichier > 20 Mo.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Format de fichier non accepté.' })
  @ApiResponse({
    status: 507,
    description:
      'Espace de stockage plein, ou documents de l’entreprise à 500 Mo toutes versions comprises ' +
      '(E10.08) : fichier non enregistré.',
  })
  @ApiResponse({
    status: 429,
    description:
      'Trop d’envois en cours pour ce compte (3) ou pour le serveur (8) : `Retry-After`, fichier ' +
      'ni conservé en mémoire ni enregistré (E10.08).',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stockage momentanément injoignable : fichier non enregistré, réessayer.',
  })
  async upload(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: { fieldId?: unknown; type?: unknown },
  ): Promise<UploadedDocument> {
    const uploaded = requireFile(file)
    const created = await this.service.uploadDocument({
      dossierId: id,
      adminId: currentUser(req).id,
      filename: uploaded.originalname,
      buffer: uploaded.buffer,
      fieldId: documentFieldIdField(body?.fieldId),
      type: documentTypeField(body?.type),
    })
    return versionResponse(created)
  }
}
