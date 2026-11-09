import {
  ForbiddenException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
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
import { DocumentsService, MAX_UPLOAD_BYTES, type DocumentGroup } from './documents.service'
import { UploadSizeGuard } from './upload-size.guard'
import { ACCEPTED_DOCUMENT_FORMATS_LABEL, grantsAccess } from '@confluent/shared'
import { DossiersService } from '../dossiers/dossiers.service'
import { DOCUMENTS_MIN_LEVEL } from '../dossiers/financeur-access'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

interface MulterFile {
  originalname: string
  buffer: Buffer
  size: number
}

// The multipart limit aborts the upload while streaming (413) instead of buffering an oversized file
// in memory first. Browsers send the file name in UTF-8, multer reads it as latin1 by default
// (`defParamCharset` is a multer option missing from Nest's MulterOptions type).
const UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  defParamCharset: 'utf8',
}

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
      '(sinon `415`). Le versioning est automatique par `(dossierId, filename)` : ré-upload avec le même nom ' +
      '→ `version += 1`, les versions précédentes sont conservées. Le fichier est stocké dans le bucket S3 ' +
      'privé sous une clé opaque.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({
    description: 'Document créé (id, filename, version, mimetype, size, createdAt).',
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
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File is required.' })
    }
    await this.dossiers.getByIdForUser(dossierId, currentUser(req).id)
    const created = await this.documents.upload({
      dossierId,
      filename: file.originalname,
      buffer: file.buffer,
    })
    return {
      id: created.id,
      filename: created.filename,
      version: created.version,
      mimetype: created.mimetype,
      size: created.size,
      createdAt: created.createdAt,
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Lister les documents (groupés par filename)',
    description:
      'Retourne un tableau de `{ filename, current, versions[] }`. Chaque version indique sa disponibilité ' +
      '(`available` avec une URL signée de téléchargement valable 15 min, `missing` si le fichier est perdu ' +
      'et doit être redéposé, `unavailable` si le stockage est momentanément injoignable). Les versions sont triées desc par `version`. Financeur : ' +
      'uniquement avec un partage de niveau `complet` (sinon `403 ACCESS_LEVEL_INSUFFICIENT`).',
  })
  @ApiOkResponse({ description: 'Documents groupés par filename.' })
  async list(@Req() req: Request, @Param('dossierId') dossierId: string): Promise<DocumentGroup[]> {
    const { accessLevel } = await this.dossiers.resolveReadAccess(dossierId, currentUser(req))
    if (!grantsAccess(accessLevel, DOCUMENTS_MIN_LEVEL)) {
      throw new ForbiddenException({
        code: 'ACCESS_LEVEL_INSUFFICIENT',
        message: 'Documents require a complete share.',
      })
    }
    return this.documents.listForDossier(dossierId)
  }
}
