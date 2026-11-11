import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger'
import {
  WORKSPACE_LOGO_FORMATS_LABEL,
  WORKSPACE_LOGO_MAX_BYTES,
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { createUploadSizeGuard } from '../documents/upload-size.guard'
import { ManageWorkspacesGuard } from '../workspaces/manage-workspaces.guard'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { WorkspacesService, type WorkspaceView } from '../workspaces/workspaces.service'

class CreateWorkspaceDto extends createZodDto(createWorkspaceSchema) {}
class UpdateWorkspaceDto extends createZodDto(updateWorkspaceSchema) {}

const LogoSizeGuard = createUploadSizeGuard(
  WORKSPACE_LOGO_MAX_BYTES,
  'Logo trop volumineux : 1 Mo maximum.',
)
const LOGO_UPLOAD_OPTIONS = { limits: { fileSize: WORKSPACE_LOGO_MAX_BYTES, files: 1, fields: 5 } }

const uuid = new ParseUUIDPipe()

const WORKSPACE_NOT_FOUND_DESCRIPTION =
  'Workspace inexistant, ou dont le compte n’est pas membre actif (même réponse).'

// Workspaces and their settings (ROADMAP E05.01). Who may act is decided by the service: creating
// and listing all workspaces is for Confluent administrators; one workspace's settings and logo
// follow the single management rule (administrators and the workspace's managers, E05.02), inside
// the workspace access check that every route naming a workspace goes through (E05.03).
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({
  description:
    'Création et liste : administrateurs seulement. Un workspace : administrateurs et gestionnaires ' +
    'actifs de ce workspace ; le domaine email reste réservé aux administrateurs.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces')
export class AdminWorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les workspaces',
    description:
      'Tous les workspaces, triés par nom, avec leurs réglages (administrateurs de Confluent ; un ' +
      'gestionnaire retrouve les siens par `GET /v1/workspaces/memberships`). `logo.url` : URL signée (15 min) de ' +
      'l’image dans le bucket privé, `null` si l’image est perdue (`missing`) ou le stockage injoignable ' +
      '(`unavailable`).',
  })
  @ApiOkResponse({ description: 'Workspaces.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceView[]> {
    return this.workspaces.list(user)
  }

  @Post()
  @ApiOperation({
    summary: 'Créer un workspace',
    description:
      'Crée un workspace (une structure). `slug` : identifiant public et définitif (minuscules, chiffres, ' +
      'tirets), déduit du nom s’il est omis ; jamais suffixé automatiquement. Réglages facultatifs : ' +
      '`programName`, `color` (`#RRGGBB`), `presentation` (texte simple, sans HTML), `contactEmail`, ' +
      '`emailDomain` (domaine imposé aux adresses des conseillers invités). Une chaîne vide vaut ' +
      '`null`. Réservé aux administrateurs de Confluent.',
  })
  @ApiCreatedResponse({ description: 'Workspace créé.' })
  @ApiBadRequestResponse({ description: 'Réglage invalide, ou aucun slug ne se déduit du nom.' })
  @ApiConflictResponse({ description: 'Slug déjà utilisé.' })
  create(
    @Body() body: CreateWorkspaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceView> {
    return this.workspaces.create(user, body)
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Détail d’un workspace' })
  @ApiNotFoundResponse({ description: WORKSPACE_NOT_FOUND_DESCRIPTION })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceView> {
    return this.workspaces.get(user, workspaceId)
  }

  @Patch(':workspaceId')
  @ApiOperation({
    summary: 'Modifier les réglages d’un workspace',
    description:
      'Seuls les réglages présents changent ; `null` ou une chaîne vide efface un réglage facultatif. ' +
      'Le `slug` ne se modifie pas (`400` s’il est envoyé). Le domaine email ne change que par un ' +
      'administrateur de Confluent (`403` pour un gestionnaire : il borne ses propres invitations).',
  })
  @ApiBadRequestResponse({ description: 'Réglage invalide.' })
  @ApiNotFoundResponse({ description: WORKSPACE_NOT_FOUND_DESCRIPTION })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: UpdateWorkspaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceView> {
    return this.workspaces.update(user, workspaceId, body)
  }

  @Post(':workspaceId/logo')
  @UseGuards(ManageWorkspacesGuard, LogoSizeGuard)
  @UseInterceptors(FileInterceptor('file', LOGO_UPLOAD_OPTIONS))
  @ApiOperation({
    summary: 'Déposer ou remplacer le logo',
    description:
      `Envoi multipart/form-data, champ \`file\`. Formats : ${WORKSPACE_LOGO_FORMATS_LABEL}, reconnus ` +
      'd’après le contenu (`415` sinon : ni SVG, ni HEIC). **1 Mo** maximum (`413`, sans lecture du corps ' +
      'quand la taille annoncée le dépasse ; `411` si elle n’est pas annoncée). L’image est stockée sous ' +
      'une clé opaque dans le bucket privé ; l’ancienne est supprimée une fois la nouvelle enregistrée.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ description: 'Workspace avec son nouveau logo.' })
  @ApiBadRequestResponse({ description: 'Fichier absent.' })
  @ApiNotFoundResponse({ description: WORKSPACE_NOT_FOUND_DESCRIPTION })
  @ApiPayloadTooLargeResponse({ description: 'Image > 1 Mo.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Format d’image non accepté.' })
  @ApiResponse({ status: 507, description: 'Espace de stockage plein : logo non enregistré.' })
  @ApiServiceUnavailableResponse({ description: 'Stockage momentanément injoignable.' })
  setLogo(
    @Param('workspaceId', uuid) workspaceId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceView> {
    return this.workspaces.setLogo(user, workspaceId, file?.buffer)
  }

  @Delete(':workspaceId/logo')
  @ApiOperation({ summary: 'Retirer le logo' })
  @ApiOkResponse({ description: 'Workspace sans logo.' })
  @ApiNotFoundResponse({ description: WORKSPACE_NOT_FOUND_DESCRIPTION })
  removeLogo(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceView> {
    return this.workspaces.removeLogo(user, workspaceId)
  }
}
