import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import {
  magicLinkRequestSchema,
  updateProfileSchema,
  type MagicLinkRequest,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import type { AppConfig } from '../../config/config.schema'
import { Public } from '../../common/decorators/public.decorator'
import { AuthService, type IssuedSession } from './auth.service'
import { REFRESH_COOKIE_NAME, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants'
import type { AuthenticatedUser } from './strategies/jwt.strategy'

class MagicLinkRequestDto extends createZodDto(magicLinkRequestSchema) {}
class VerifyQueryDto extends createZodDto(z.object({ token: z.string().uuid() })) {}
class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('magic-link')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Demande d’un lien de connexion par email',
    description:
      'Déclenche l’envoi d’un mail contenant un lien `/auth/verify?token=<uuid>` (TTL 15 min, usage unique). ' +
      'La réponse est **toujours** `200` même si l’email est inconnu : pas d’énumération possible. ' +
      'Le rate-limit est de 10 requêtes / IP / minute.',
  })
  @ApiOkResponse({
    description: 'Le lien a été dispatché (ou silencieusement ignoré si email inconnu).',
    schema: { example: { message: 'Magic link sent.' } },
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit atteint (10/min).' })
  async requestMagicLink(@Body() body: MagicLinkRequestDto): Promise<{ message: string }> {
    const { email }: MagicLinkRequest = body
    await this.auth.requestMagicLink(email)
    return { message: 'Magic link sent.' }
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Consommation d’un magic-link',
    description:
      'Échange un token magic-link valide contre un couple access/refresh :\n' +
      '- `accessToken` (JWT, TTL 15 min) retourné dans le body\n' +
      '- `refreshToken` (JWT, TTL 7j) posé dans un cookie `confluent_refresh` httpOnly, SameSite=Strict\n\n' +
      'Le token est **single-use** : toute seconde consommation retourne `401`.',
  })
  @ApiOkResponse({
    description: 'Session ouverte. Le cookie refresh est posé dans l’en-tête `Set-Cookie`.',
  })
  @ApiUnauthorizedResponse({ description: 'Token expiré, déjà consommé ou inconnu.' })
  async verifyMagicLink(
    @Query() query: VerifyQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: IssuedSession['user'] }> {
    const session = await this.auth.verifyMagicLink(query.token)
    this.setRefreshCookie(res, session.refreshToken)
    return { accessToken: session.accessToken, user: session.user }
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({
    summary: 'Rotation du couple access/refresh',
    description:
      'Lit le cookie `confluent_refresh`, vérifie sa signature, sa session serveur et l’état `isActive` ' +
      'de l’user, puis ré-émet un nouvel access token + un nouveau cookie refresh. Le refresh présenté ' +
      'est révoqué (usage unique) ; le réutiliser plus tard révoque toute la session (vol présumé). ' +
      'Appelé automatiquement par le client après un `401` sur une route protégée.',
  })
  @ApiOkResponse({ description: 'Nouveau couple de tokens émis.' })
  @ApiUnauthorizedResponse({ description: 'Cookie manquant, expiré, invalidé, ou user désactivé.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: IssuedSession['user'] }> {
    const refreshCookie = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined
    const session = await this.auth.refreshSession(refreshCookie)
    this.setRefreshCookie(res, session.refreshToken)
    return { accessToken: session.accessToken, user: session.user }
  }

  @Patch('profile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mettre à jour le prénom et le nom du compte connecté' })
  @ApiOkResponse({ description: 'Profil mis à jour.' })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  updateProfile(
    @Req() req: Request,
    @Body() body: UpdateProfileDto,
  ): Promise<{ firstName: string; lastName: string }> {
    return this.auth.updateProfile(currentUser(req).id, body.firstName, body.lastName)
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Déconnexion',
    description:
      'Révoque côté serveur toute la session de connexion du cookie `confluent_refresh` (le refresh ' +
      'token et ses rotations ne peuvent plus être utilisés), puis efface le cookie. L’access token ' +
      'déjà émis reste valide jusqu’à expiration (15 min max), sauf compte désactivé.',
  })
  @ApiOkResponse({ description: 'Session révoquée, cookie refresh effacé.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.auth.revokeSession(req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined)
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' })
    return { message: 'Logged out.' }
  }

  private setRefreshCookie(res: Response, token: string): void {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production'
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    })
  }
}
