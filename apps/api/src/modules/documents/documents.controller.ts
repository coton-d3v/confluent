import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
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
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
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
  dossierDocumentSelectionSchema,
  updateDocumentSchema,
  type DossierDocumentSelected,
  type LibraryDocument,
  type UploadedDocument,
} from '@confluent/shared'
import { DocumentsService, type DocumentGroup } from './documents.service'
import {
  UPLOAD_OPTIONS,
  documentFieldIdField,
  documentTypeField,
  requireFile,
  versionResponse,
  type MulterFile,
} from './upload-request'
import { UploadSizeGuard } from './upload-size.guard'
import { DossiersService } from '../dossiers/dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class UpdateDocumentDto extends createZodDto(updateDocumentSchema) {}
class DossierDocumentSelectionDto extends createZodDto(dossierDocumentSelectionSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Documents')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
@Controller('dossiers/:dossierId/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly dossiers: DossiersService,
  ) {}

  @Post()
  @UseGuards(UploadSizeGuard)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  @ApiOperation({
    summary: 'Upload d’un document',
    description:
      'Envoi multipart/form-data, champ `file`. Max **20 MB** : `413` sans lecture du corps quand la taille ' +
      'annoncée le dépasse, sinon dès que la limite est franchie ; `411` si la taille n’est pas annoncée. ' +
      `Formats acceptés, reconnus d’après le contenu et non d’après le type annoncé : ${ACCEPTED_DOCUMENT_FORMATS_LABEL} ` +
      '(sinon `415`). Le document rejoint ceux de l’entreprise du dossier (E05.05). Le versioning est ' +
      'automatique par `(fieldId, filename)` dans l’entreprise : ré-upload avec le même nom → `version += 1`, ' +
      'les versions précédentes sont conservées. Le fichier est stocké dans le bucket S3 ' +
      'privé sous une clé opaque. Champ facultatif `fieldId` : le document répond au champ « pièce jointe » ' +
      'du profil de l’entreprise (`400` si ce n’est pas un champ pièce jointe de sa version) et suit son ' +
      'niveau de lecture. Champ facultatif `type` (E05.06) : type du document créé, parmi ' +
      `${DOCUMENT_TYPES.join(', ')} (other par défaut, 400 si inconnu) ; ` +
      'ignoré pour une nouvelle version d’un document existant, qui garde son type (le changer par `PATCH`).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        fieldId: {
          type: 'string',
          format: 'uuid',
          description: 'Champ « pièce jointe » auquel le document répond (facultatif).',
        },
        type: {
          type: 'string',
          enum: [...DOCUMENT_TYPES],
          description: 'Type du document créé (facultatif, `other` par défaut).',
        },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({
    description:
      'Version créée (id, documentId, filename, type, version, restoredFromVersion, mimetype, size, fieldId, createdAt).',
  })
  @ApiBadRequestResponse({
    description: 'Fichier absent, `fieldId` invalide pour ce dossier ou `type` inconnu.',
  })
  @ApiPayloadTooLargeResponse({ description: 'Fichier > 20 MB.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Format de fichier non accepté.' })
  @ApiResponse({ status: 507, description: 'Espace de stockage plein : fichier non enregistré.' })
  @ApiServiceUnavailableResponse({
    description: 'Stockage momentanément injoignable : fichier non enregistré, réessayer.',
  })
  async upload(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: { fieldId?: unknown; type?: unknown },
  ): Promise<UploadedDocument> {
    const uploaded = requireFile(file)
    const dossier = await this.dossiers.getByIdForUser(dossierId, currentUser(req).id)
    const created = await this.documents.upload({
      dossier,
      filename: uploaded.originalname,
      buffer: uploaded.buffer,
      fieldId: documentFieldIdField(body?.fieldId),
      type: documentTypeField(body?.type),
    })
    return versionResponse(created)
  }

  @Patch(':documentId')
  @ApiParam({ name: 'documentId', description: 'UUID du document (`id` d’un document listé)' })
  @ApiOperation({
    summary: 'Changer le type d’un document (E05.06)',
    description:
      'Propriétaire du dossier seulement (sinon `404`, comme un dossier inconnu). Le type vaut pour ' +
      'toutes les versions du document ; le changement est inscrit au journal du dossier.',
  })
  @ApiOkResponse({ description: 'Document (id, filename, fieldId, type).' })
  @ApiBadRequestResponse({ description: 'Type inconnu.' })
  async update(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpdateDocumentDto,
  ): Promise<LibraryDocument> {
    const user = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, user.id)
    const updated = await this.documents.setType({
      dossier,
      documentId,
      type: body.type,
      actorId: user.id,
    })
    return {
      id: updated.id,
      filename: updated.filename,
      fieldId: updated.fieldId,
      type: updated.type,
    }
  }

  @Put(':documentId/selection')
  @ApiParam({ name: 'documentId', description: 'UUID du document de la bibliothèque' })
  @ApiOperation({
    summary: 'Sélectionner un document pour cette demande (E05.07)',
    description:
      'Propriétaire du dossier seulement (sinon `404`). Le dossier présente ce document de la ' +
      'bibliothèque de son entreprise à ses partages : `pinnedVersionId` `null` pour suivre sa ' +
      'dernière version, ou l’identifiant d’une de ses versions pour l’épingler. Seuls les documents ' +
      'sélectionnés, à cette version, sont montrés aux destinataires des partages (toujours selon ' +
      'leur niveau). Rappeler la route change le mode. Journalisé.',
  })
  @ApiOkResponse({ description: 'Sélection (documentId, pinnedVersionId).' })
  @ApiBadRequestResponse({ description: 'Corps invalide.' })
  @ApiNotFoundResponse({
    description: 'Dossier ou document inconnu, ou version qui n’appartient pas au document.',
  })
  async select(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('documentId') documentId: string,
    @Body() body: DossierDocumentSelectionDto,
  ): Promise<DossierDocumentSelected> {
    const user = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, user.id)
    return this.documents.select({
      dossier,
      documentId,
      pinnedVersionId: body.pinnedVersionId,
      actorId: user.id,
    })
  }

  @Delete(':documentId/selection')
  @HttpCode(204)
  @ApiParam({ name: 'documentId', description: 'UUID du document de la bibliothèque' })
  @ApiOperation({
    summary: 'Retirer un document de cette demande (E05.07)',
    description:
      'Propriétaire du dossier seulement (sinon `404`). Les partages du dossier ne montrent plus ce ' +
      'document dès la requête suivante ; il reste dans la bibliothèque. Sans effet s’il n’était pas ' +
      'sélectionné. Journalisé.',
  })
  @ApiNoContentResponse({ description: 'Document retiré de la demande.' })
  async unselect(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    const user = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, user.id)
    await this.documents.unselect({ dossier, documentId, actorId: user.id })
  }

  @Post(':documentId/versions/:versionId/restore')
  @HttpCode(201)
  @ApiParam({ name: 'documentId', description: 'UUID du document' })
  @ApiParam({ name: 'versionId', description: 'UUID de la version à restaurer' })
  @ApiOperation({
    summary: 'Restaurer une version antérieure (E05.06)',
    description:
      'Propriétaire du dossier seulement (sinon `404`). Ajoute une **nouvelle version**, la plus ' +
      'récente du document, au contenu de la version choisie (même fichier stocké, ' +
      '`restoredFromVersion` indique laquelle) : aucune version n’est modifiée ni effacée. Inscrit au ' +
      'journal du dossier.',
  })
  @ApiCreatedResponse({ description: 'Version créée, au même format que le dépôt.' })
  @ApiConflictResponse({ description: 'La version choisie est déjà la version en vigueur.' })
  @ApiGoneResponse({ description: 'Le fichier de cette version est perdu : rien n’est créé.' })
  @ApiServiceUnavailableResponse({
    description: 'Stockage momentanément injoignable : rien n’est créé, réessayer.',
  })
  async restore(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ): Promise<UploadedDocument> {
    const user = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, user.id)
    const restored = await this.documents.restoreVersion({
      dossier,
      documentId,
      versionId,
      actorId: user.id,
    })
    return versionResponse(restored)
  }

  @Get()
  @ApiOperation({
    summary: 'Lister les documents (groupés par filename)',
    description:
      'Retourne un tableau de `{ id, filename, fieldId, type, current, versions[] }` : la bibliothèque de l’entreprise du dossier (E05.05, E05.06), un document par nom et par question, avec son type. Chaque version a son `id`, indique la version qu’elle a restaurée (`restoredFromVersion`, null pour un dépôt) et sa disponibilité ' +
      '(`available` avec une URL signée de téléchargement valable 15 min, `missing` si le fichier est perdu ' +
      'et doit être redéposé, `unavailable` si le stockage est momentanément injoignable). Les versions sont triées desc par `version`. ' +
      'Chaque version indique le champ « pièce jointe » auquel elle répond (`fieldId`, null sinon). ' +
      'Propriétaire : toute la bibliothèque, chaque document avec `selection` (comment ce dossier le sélectionne, ' +
      '`pinnedVersionId` null = dernière version suivie ; `null` = non sélectionné, E05.07). Financeur : seuls les documents ' +
      'sélectionnés par ce dossier, avec la seule version sélectionnée (la dernière ou celle épinglée), et que son niveau de ' +
      'partage permet de lire — celui du champ pour une pièce jointe, `complet` pour les autres documents.',
  })
  @ApiOkResponse({ description: 'Documents groupés par filename.' })
  async list(@Req() req: Request, @Param('dossierId') dossierId: string): Promise<DocumentGroup[]> {
    const { dossier, accessLevel, relation } = await this.dossiers.resolveReadAccess(
      dossierId,
      currentUser(req),
    )
    return this.documents.listForDossier(dossier, accessLevel, relation)
  }
}
