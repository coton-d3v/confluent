import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AppConfig } from '../../config/config.schema'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { PrismaService } from '../../prisma/prisma.service'
import { expandScopes } from '../oauth/oauth.constants'
import { ConfluentOAuthProvider, type ConfluentAuthExtra } from '../oauth/oauth.provider'
import { McpToolsFactory, toolScope } from './mcp.tools'

type JsonRpcMessage = { method?: string; params?: { name?: string; arguments?: unknown } }

// Mounts the remote MCP endpoint (Streamable HTTP, stateless) at `/mcp`.
export function mountMcpEndpoint(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>)
  const provider = app.get(ConfluentOAuthProvider)
  const tools = app.get(McpToolsFactory)
  const prisma = app.get(PrismaService)
  const publicUrl = config.get('API_PUBLIC_URL', { infer: true })
  const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource/mcp`
  const allowedOrigins = new Set(
    [
      config.get('FRONTEND_URL', { infer: true }),
      ...config.get('MCP_ALLOWED_ORIGINS', { infer: true }).split(','),
    ]
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )

  // MCP spec: servers MUST validate Origin (DNS-rebinding protection). Server-side clients send none.
  const checkOrigin = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin
    if (origin && !allowedOrigins.has(origin.replace(/\/+$/, ''))) {
      res
        .status(403)
        .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' } })
      return
    }
    next()
  }

  // Stateless transport (MCP 2026-07-28 drops protocol sessions and the GET stream).
  const methodNotAllowed = (_req: Request, res: Response) => {
    res
      .set('Allow', 'POST')
      .status(405)
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed: use POST' },
      })
  }

  // Answer a write tool called with a read-only grant with a proper scope challenge (403 +
  // WWW-Authenticate insufficient_scope) so the client can ask the user for more permissions.
  const checkToolScopes = (req: Request, res: Response, next: NextFunction) => {
    const messages = (Array.isArray(req.body) ? req.body : [req.body]) as JsonRpcMessage[]
    const granted = expandScopes(req.auth?.scopes ?? [])
    const missing = messages
      .filter((m) => m?.method === 'tools/call' && m.params?.name)
      .map((m) => toolScope(m.params!.name!, m.params!.arguments))
      .filter((scope): scope is string => !!scope && !granted.has(scope))
    if (missing.length) {
      const scope = [...new Set(missing)].join(' ')
      res
        .set(
          'WWW-Authenticate',
          `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${resourceMetadataUrl}", ` +
            `error_description="This tool needs: ${scope}"`,
        )
        .status(403)
        .json({ error: 'insufficient_scope', error_description: `This tool needs: ${scope}` })
      return
    }
    next()
  }

  const handle = async (req: Request, res: Response) => {
    const extra = req.auth!.extra as ConfluentAuthExtra
    const user = await prisma.user.findUnique({ where: { id: extra.userId } })
    if (!user) {
      res.status(401).json({ error: 'invalid_token' })
      return
    }
    const server = tools.createServer({
      user: { id: user.id, email: user.email, role: user.role } satisfies AuthenticatedUser,
      scopes: req.auth!.scopes,
      clientId: req.auth!.clientId,
      clientName: extra.clientName,
      grantId: extra.grantId,
      workspaceIds: extra.workspaceIds ?? [],
    })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }

  const parseJson = express.json({ limit: '1mb' })
  app.use(
    '/mcp',
    checkOrigin,
    (req: Request, res: Response, next: NextFunction) =>
      req.method === 'POST' ? next() : methodNotAllowed(req, res),
    requireBearerAuth({ verifier: provider, resourceMetadataUrl }),
    // Wrapped on purpose: a middleware *named* `jsonParser` in the stack makes Nest skip its global
    // JSON parser, which would break every JSON body of the REST API.
    function mcpJsonParser(req: Request, res: Response, next: NextFunction) {
      parseJson(req, res, next)
    },
    checkToolScopes,
    (req: Request, res: Response, next: NextFunction) => {
      handle(req, res).catch(next)
    },
  )
}
