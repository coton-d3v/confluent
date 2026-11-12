import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { WORKSPACE_PAGE_LIMITS, updateWorkspacePageSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  WorkspacePagesService,
  type PublicWorkspacePageView,
  type WorkspacePageSettingsView,
} from './workspace-pages.service'

class UpdateWorkspacePageDto extends createZodDto(updateWorkspacePageSchema) {}

const uuid = new ParseUUIDPipe()

// Per network address and per minute (ThrottlerGuard, in the API's memory: per instance).
export const WORKSPACE_PAGE_RATE_LIMITS = { page: 30, logo: 60 } as const

const NOT_FOUND =
  'Aucun workspace sous ce slug, ou page publique non publiée : même réponse, qui ne dit pas si le ' +
  'workspace existe.'

// ROADMAP E09.01: a workspace's public page — no account, no session.
@ApiTags('Vitrine (public)')
@Public()
@ApiParam({ name: 'slug', description: 'Slug du workspace' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@ApiTooManyRequestsResponse({ description: 'Rate limit atteint.' })
@Controller('public/workspaces/:slug')
export class PublicWorkspacePagesController {
  constructor(private readonly pages: WorkspacePagesService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: WORKSPACE_PAGE_RATE_LIMITS.page } })
  @ApiOperation({
    summary: 'Page publique d’un workspace',
    description:
      'Seulement si ses gestionnaires l’ont publiée. `workspace` : slug, nom, programme, couleur, ' +
      'présentation, critères, contact (textes simples, jamais du HTML) et `logoVersion` (`null` sans ' +
      'logo ; l’image : `GET …/logo`) — jamais l’identifiant, les membres, l’email de contact des ' +
      'membres ni aucun réglage interne. `committees` : les prochaines sessions ouvertes aux ' +
      `demandes de participation (au plus ${WORKSPACE_PAGE_LIMITS.committees}), par nom, date, ` +
      'heure et fuseau (`toPublicCommittee` : ni lieu, ni lien, ni informations diffusées, ni notes ' +
      'internes). `receivesCandidatures` : un formulaire de candidature est publié (candidature ' +
      `depuis un compte Confluent). Rate-limit ${WORKSPACE_PAGE_RATE_LIMITS.page} req/min/IP.`,
  })
  @ApiOkResponse({ description: 'Page publique.' })
  page(@Param('slug') slug: string): Promise<PublicWorkspacePageView> {
    return this.pages.publicPage(slug)
  }

  @Get('logo')
  @Throttle({ default: { ttl: 60_000, limit: WORKSPACE_PAGE_RATE_LIMITS.logo } })
  @ApiOperation({
    summary: 'Logo de la page publique',
    description:
      'L’image du logo (PNG, JPEG ou WebP, ≤ 1 Mo), lue par l’API dans le bucket privé tant que la ' +
      'page est publiée : aucune adresse du bucket n’est donnée. `404` identique sans page publiée, ' +
      'sans logo ou image perdue. Mise en cache 5 min. ' +
      `Rate-limit ${WORKSPACE_PAGE_RATE_LIMITS.logo} req/min/IP.`,
  })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiOkResponse({ description: 'Image du logo.' })
  @ApiServiceUnavailableResponse({ description: 'Stockage momentanément injoignable.' })
  async logo(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimetype } = await this.pages.logo(slug)
    // Shown by the site from another origin than the API's (helmet's default is same-origin), never
    // as a document: no script, no sniffing.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'public, max-age=300')
    return new StreamableFile(buffer, { type: mimetype, length: buffer.byteLength })
  }
}

// The page's settings, for the workspace's managers.
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/public-page')
export class WorkspacePageController {
  constructor(private readonly pages: WorkspacePagesService) {}

  @Get()
  @ApiOperation({
    summary: 'Réglages de la page publique',
    description:
      'Publiée ou non, critères, contact, `version` ; `preview` : ce que le public voit (ou verra une ' +
      'fois la page publiée), construit comme la route publique. Gestionnaires et administrateurs.',
  })
  @ApiOkResponse({ description: 'Réglages et aperçu.' })
  settings(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspacePageSettingsView> {
    return this.pages.settings(user, workspaceId)
  }

  @Put()
  @ApiOperation({
    summary: 'Modifier la page publique',
    description:
      '`published` (la page n’existe pour le public qu’une fois publiée : non publiée par défaut), ' +
      `\`criteria\` (≤ ${WORKSPACE_PAGE_LIMITS.criteria}) et \`contact\` ` +
      `(≤ ${WORKSPACE_PAGE_LIMITS.contact}) en texte simple sans balise — visibles par tous une ` +
      'fois publiée : une adresse ou un numéro écrit dans le contact devient public —, tous ' +
      'renvoyés avec la `version` lue. Mêmes valeurs : rien n’est écrit. Journal ' +
      '`workspace_updated` (champs nommés, textes jamais copiés).',
  })
  @ApiOkResponse({ description: 'Réglages enregistrés et aperçu.' })
  @ApiBadRequestResponse({ description: 'Réglage invalide.' })
  @ApiConflictResponse({
    description: 'Page modifiée entre-temps (`details.currentVersion`) : la relire.',
  })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: UpdateWorkspacePageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspacePageSettingsView> {
    return this.pages.update(user, workspaceId, body)
  }
}
