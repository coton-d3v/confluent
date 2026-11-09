import type { INestApplication } from '@nestjs/common'
import express, { type NextFunction, type Request, type Response } from 'express'
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js'
import { createOAuthMetadata, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { ConfluentOAuthProvider } from './oauth.provider'
import { SUPPORTED_SCOPES } from './oauth.constants'

// RFC 6749 client_secret_basic → the SDK only reads client credentials from the form body. Runs after
// the form is parsed (the SDK's own parser then skips), otherwise parsing would overwrite them.
function basicAuthToBody(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const sep = decoded.indexOf(':')
    if (sep > 0) {
      const body = (req.body ?? {}) as Record<string, string>
      body.client_id ??= decodeURIComponent(decoded.slice(0, sep))
      body.client_secret ??= decodeURIComponent(decoded.slice(sep + 1))
      req.body = body
    }
  }
  next()
}

// RFC 9207 (code review R15): the SDK builds error redirects of /authorize itself, without `iss`, and
// without `state` when the request failed to parse. Any redirect back to the client carrying `error`
// gets the exact issuer we advertise and the client's state.
function issuerOnErrorRedirects(issuer: string) {
  return function addIssuer(req: Request, res: Response, next: NextFunction): void {
    const params = (req.method === 'POST' ? req.body : req.query) as
      | Record<string, unknown>
      | undefined
    const state = typeof params?.state === 'string' ? params.state : undefined
    const redirect = res.redirect.bind(res) as (status: number, url: string) => void
    res.redirect = ((statusOrUrl: number | string, maybeUrl?: string) => {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
      const target = typeof statusOrUrl === 'string' ? statusOrUrl : maybeUrl!
      try {
        const url = new URL(target)
        if (url.searchParams.has('error')) {
          if (!url.searchParams.has('iss')) url.searchParams.set('iss', issuer)
          if (state && !url.searchParams.has('state')) url.searchParams.set('state', state)
          return redirect(status, url.href)
        }
      } catch {
        // relative or invalid target: left as is
      }
      return redirect(status, target)
    }) as Response['redirect']
    next()
  }
}

// Mounts the OAuth 2.1 authorization server (outside the `/v1` prefix, as MCP clients expect):
// /authorize, /token, /register, /revoke and the RFC 8414 / RFC 9728 discovery documents.
export function mountOAuthServer(app: INestApplication): void {
  const provider = app.get(ConfluentOAuthProvider)
  const issuerUrl = new URL(provider.issuer)
  const resourceServerUrl = new URL(provider.resource)

  // The SDK metadata lacks what the MCP 2026-07-28 spec expects us to advertise: CIMD support,
  // RFC 9207 `iss` in authorization responses, and client_secret_basic (handled above).
  const oauthMetadata = {
    ...createOAuthMetadata({ provider, issuerUrl, scopesSupported: SUPPORTED_SCOPES }),
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
      'client_secret_basic',
    ],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }
  const protectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [issuerUrl.href],
    scopes_supported: SUPPORTED_SCOPES,
    resource_name: 'Confluent',
    bearer_methods_supported: ['header'],
  }

  app.use('/.well-known/oauth-authorization-server', metadataHandler(oauthMetadata))
  app.use('/.well-known/oauth-protected-resource', metadataHandler(protectedResourceMetadata))
  // Wrapped: Nest skips its own global body parsers when it finds a middleware *named*
  // `urlencodedParser`/`jsonParser` anywhere in the Express stack — a bare `express.urlencoded()`
  // here would silently disable form parsing for every Nest route.
  const parseForm = express.urlencoded({ extended: false })
  app.use(
    ['/token', '/revoke'],
    function oauthFormParser(req: Request, res: Response, next: NextFunction) {
      parseForm(req, res, next)
    },
    basicAuthToBody,
  )
  app.use('/authorize', issuerOnErrorRedirects(issuerUrl.href))
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl,
      scopesSupported: SUPPORTED_SCOPES,
      resourceName: 'Confluent',
    }),
  )
}
