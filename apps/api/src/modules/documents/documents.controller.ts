import {
  ForbiddenException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { DocumentsService, type DocumentGroup } from './documents.service'
import { grantsAccess } from '@confluent/shared'
import { DossiersService } from '../dossiers/dossiers.service'
import { DOCUMENTS_MIN_LEVEL } from '../dossiers/financeur-access'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

interface MulterFile {
  originalname: string
  mimetype: string
  buffer: Buffer
  size: number
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
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload d’un document',
    description:
      'Envoi multipart/form-data, champ `file`. Max **20 MB** (sinon `413`). Le versioning est ' +
      'automatique par `(dossierId, filename)` : ré-upload avec le même nom → `version += 1`, les versions ' +
      'précédentes sont conservées. Le fichier est stocké dans le `StorageAdapter` (MinIO en dev, S3 en prod).',
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
      mimetype: file.mimetype,
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
      'Retourne un tableau de `{ filename, current, versions[] }`. Chaque entrée inclut une URL signée ' +
      '(TTL 15 min) pour download direct. Les versions sont triées desc par `version`. Financeur : ' +
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
