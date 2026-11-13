import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod'
import cookieParser from 'cookie-parser'
import basicAuth from 'express-basic-auth'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { corsOptions } from './common/http/cors'
import { noIndex } from './common/http/no-index'
import { mountOAuthServer } from './modules/oauth/oauth.http'
import { mountMcpEndpoint } from './modules/mcp/mcp.http'
import { swaggerMode, type AppConfig } from './config/config.schema'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const config = app.get(ConfigService<AppConfig, true>)

  app.set('trust proxy', 1)
  app.use(helmet())
  // E09.06: every answer, ahead of everything (OAuth, MCP and the documentation are served outside
  // Nest's routes; a wildcard Nest middleware would be narrowed to `/` by the prefix's exclusion).
  app.use(noIndex)
  app.use(cookieParser())
  // OAuth 2.1 server for MCP clients, at the root (not under /v1) as clients discover it there.
  mountOAuthServer(app)
  // Remote MCP endpoint (Claude, ChatGPT…), protected by the OAuth tokens above.
  mountMcpEndpoint(app)
  app.setGlobalPrefix('v1', { exclude: ['/'] })
  app.useGlobalPipes(new ZodValidationPipe())
  app.useGlobalFilters(new GlobalExceptionFilter())
  app.enableCors(corsOptions(config.get('FRONTEND_URL', { infer: true })))

  const swagger = swaggerMode({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
    SWAGGER_PASSWORD: config.get('SWAGGER_PASSWORD', { infer: true }),
  })
  if (swagger === 'open' || swagger === 'basic-auth') {
    setupSwagger(app, config, swagger === 'basic-auth')
  }

  const port = config.get('PORT', { infer: true })
  await app.listen(port)
  const logger = new Logger('Bootstrap')
  logger.log(`Application is running on: http://localhost:${port}`)
  if (swagger === 'open' || swagger === 'basic-auth') {
    const guarded = swagger === 'basic-auth' ? ' (basic auth)' : ' (open, dev mode)'
    logger.log(`Swagger UI: http://localhost:${port}/api/docs${guarded}`)
  } else if (swagger === 'refused-default-password') {
    logger.warn(
      'Swagger UI not served: SWAGGER_PASSWORD still has its published default value ' +
        '(set your own, or SWAGGER_ENABLED=false).',
    )
  }
}

function setupSwagger(
  app: NestExpressApplication,
  config: ConfigService<AppConfig, true>,
  withBasicAuth: boolean,
): void {
  // Prod-only: HTTP Basic Auth in front of the docs endpoint.
  if (withBasicAuth) {
    const user = config.get('SWAGGER_USER', { infer: true })
    const password = config.get('SWAGGER_PASSWORD', { infer: true })
    const users: Record<string, string> = { [user]: password }
    app.use(
      ['/api/docs', '/api/docs-json'],
      basicAuth({ challenge: true, realm: 'Confluent API Docs', users }),
    )
  }

  const openApiConfig = new DocumentBuilder()
    .setTitle('Confluent API')
    .setDescription(
      'API REST de la plateforme Confluent — intermédiation entre entrepreneurs, ' +
        'financeurs et administrateurs autour des dossiers d’investissement.\n\n' +
        'Authentification JWT : `Authorization: Bearer <access_token>` obtenu via le flow ' +
        'magic-link (`POST /v1/auth/magic-link` → mail → `GET /v1/auth/verify`). ' +
        'Le refresh token vit dans un cookie httpOnly `confluent_refresh` (rotation via ' +
        '`POST /v1/auth/refresh`). Les routes `/v1/admin/*` exigent un JWT `role: admin`. ' +
        'La route financeur `GET /v1/shares/:token` est publique, protégée par un UUID non-devinable.',
    )
    .setVersion(process.env.APP_VERSION ?? 'dev')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token (15 min TTL) — obtenu via GET /v1/auth/verify',
      },
      'jwt',
    )
    .addCookieAuth('confluent_refresh', { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
    .addTag('Auth', 'Magic-link, vérification, refresh, logout.')
    .addTag('Dossiers', 'CRUD des dossiers entrepreneur (scope JWT user).')
    .addTag('Questionnaire', 'Questionnaire actif (public) + réponses par dossier (entrepreneur).')
    .addTag('Documents', 'Upload + versioning de fichiers attachés à un dossier.')
    .addTag('Partages', 'Liens de partage vers les financeurs (CSPRNG, révocables).')
    .addTag(
      'Opportunités',
      'Demandes partagées avec l’investisseur ou publiées aux viviers de ses workspaces.',
    )
    .addTag('Analytics', 'Stats de consultation par dossier, par financeur.')
    .addTag('Audit', 'Journal append-only (entrepreneur-scoped + admin-scoped).')
    .addTag('Admin · Dossiers', 'Accès + édition admin sur tous les dossiers (audité).')
    .addTag('Admin · Questionnaire', 'Versioning immuable du questionnaire (FR14).')
    .addTag('Admin · Utilisateurs', 'Invitation, désactivation, réactivation.')
    .addTag('Admin · Analytics', 'Statistiques plateforme.')
    .addTag('Admin · Partages', 'Révocation admin transversale.')
    .addTag('Santé', 'Healthcheck public.')
    .build()

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, openApiConfig))
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'Confluent API — docs',
  })
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(
    'Failed to start application',
    err instanceof Error ? err.stack : String(err),
  )
  process.exit(1)
})
