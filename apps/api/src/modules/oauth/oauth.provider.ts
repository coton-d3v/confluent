import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  canReviewCandidatures,
  type OAuthConsentRequest,
  type OAuthConsentWorkspace,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { canManageWorkspace } from '../workspaces/workspace-access'
import { WorkspaceMembersService } from '../workspaces/workspace-members.service'
import { OAuthClientsStore } from './oauth-clients.store'
import {
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  AUTHORIZATION_REQUEST_TTL_MS,
  GRANT_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  SCOPE_LABELS,
  SUPPORTED_SCOPES,
  hashToken,
  mcpResourceUrl,
  newOpaqueToken,
  expandScopes,
  type GrantContext,
  grantableScopes,
} from './oauth.constants'

// Extra fields carried by AuthInfo for the MCP endpoint.
export interface ConfluentAuthExtra extends Record<string, unknown> {
  userId: string
  grantId: string
  clientName: string
  // E05.10: the workspaces the person allowed this connection to reach (the grant's, never wider).
  workspaceIds: string[]
}

// What an account may consent to (E05.10): its active memberships, offered as the workspaces an
// application may reach, and whether it manages one of them (form permissions, E05.09).
interface ConsentOptions extends GrantContext {
  workspaces: OAuthConsentWorkspace[]
}

// RFC 8707 canonical comparison: lowercase scheme/host, no trailing slash.
function canonical(uri: string): string {
  const url = new URL(uri)
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
}

@Injectable()
export class ConfluentOAuthProvider implements OAuthServerProvider {
  private readonly logger = new Logger(ConfluentOAuthProvider.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly audit: AuditService,
    private readonly clients: OAuthClientsStore,
    private readonly members: WorkspaceMembersService,
  ) {}

  get clientsStore(): OAuthClientsStore {
    return this.clients
  }

  // Exact string published as `issuer`, in `authorization_servers` and as `iss` (RFC 9207): clients
  // compare them verbatim, so it is always the normalized URL form (`https://host/`).
  get issuer(): string {
    return new URL(this.config.get('API_PUBLIC_URL', { infer: true })).href
  }

  get resource(): string {
    return mcpResourceUrl(this.config.get('API_PUBLIC_URL', { infer: true }))
  }

  private assertResource(resource: URL | string | undefined): void {
    if (resource && canonical(resource.toString()) !== canonical(this.resource)) {
      throw new InvalidTargetError(`This server only issues tokens for ${this.resource}`)
    }
  }

  // Step 1 — the SDK validated client_id/redirect_uri/PKCE method; park the request and send the
  // user to the web consent screen, where they log in with their usual magic link.
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.assertResource(params.resource)
    const requested = params.scopes?.filter(Boolean) ?? []
    const unknown = requested.filter((s) => !SUPPORTED_SCOPES.includes(s))
    if (unknown.length) throw new InvalidScopeError(`Unsupported scope: ${unknown.join(' ')}`)
    const request = await this.prisma.oAuthAuthorizationRequest.create({
      data: {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        // No scope requested → ask for everything this server offers; the user can narrow it.
        scopes: requested.length ? requested : SUPPORTED_SCOPES,
        codeChallenge: params.codeChallenge,
        state: params.state ?? null,
        resource: this.resource,
        expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
      },
    })
    const consent = new URL('/oauth/consent', this.config.get('FRONTEND_URL', { infer: true }))
    consent.searchParams.set('request', request.id)
    res.redirect(302, consent.toString())
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = await this.findLiveCode(client, authorizationCode)
    return code.codeChallenge!
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.assertResource(resource)
    const code = await this.findLiveCode(client, authorizationCode)
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request')
    }
    // Single use, atomically: a replayed code gets nothing. Consuming the code and issuing its
    // tokens form one transaction: a failure in between leaves the code usable (code review R14).
    return this.prisma.$transaction(async (tx) => {
      const used = await tx.oAuthToken.updateMany({
        where: { id: code.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      if (used.count !== 1) throw new InvalidGrantError('Authorization code already used')
      return this.issueTokens(tx, code.grant.id, code.scopes)
    })
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.assertResource(resource)
    const token = await this.prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { grant: true },
    })
    if (!token || token.kind !== 'refresh' || token.grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token')
    }
    if (token.usedAt || token.revokedAt) {
      // MCP spec: public clients MUST get rotated refresh tokens. A rotated token replayed after
      // the retry window means theft → the whole connection is revoked.
      const since = Date.now() - (token.usedAt ?? token.revokedAt)!.getTime()
      if (token.usedAt && since > REFRESH_REUSE_GRACE_MS) {
        await this.revokeGrant(token.grant.id, token.grant.userId, 'refresh_token_reused')
      }
      throw new InvalidGrantError('Refresh token already used')
    }
    if (token.expiresAt.getTime() <= Date.now() || !(await this.grantIsUsable(token.grant))) {
      throw new InvalidGrantError('Refresh token expired or revoked')
    }
    const granted = token.scopes
    const narrowed = scopes?.length ? scopes : granted
    if (narrowed.some((s) => !granted.includes(s))) {
      throw new InvalidScopeError('Requested scope exceeds the original grant')
    }
    // Rotation in one transaction (R14): the old refresh token is spent only if its successors exist.
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.oAuthToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      })
      if (claimed.count !== 1) throw new InvalidGrantError('Refresh token already used')
      return this.issueTokens(tx, token.grant.id, narrowed)
    })
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(accessToken) },
      include: { grant: { include: { client: { select: { name: true } } } } },
    })
    if (
      !token ||
      token.kind !== 'access' ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      canonical(token.grant.resource) !== canonical(this.resource) ||
      !(await this.grantIsUsable(token.grant))
    ) {
      throw new InvalidTokenError('Invalid or expired access token')
    }
    // Best effort, for the "connected applications" page.
    void this.prisma.oAuthGrant
      .update({ where: { id: token.grantId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)
    return {
      token: accessToken,
      clientId: token.grant.clientId,
      scopes: token.scopes,
      expiresAt: Math.floor(token.expiresAt.getTime() / 1000),
      resource: new URL(token.grant.resource),
      extra: {
        userId: token.grant.userId,
        grantId: token.grantId,
        clientName: token.grant.client.name,
        workspaceIds: token.grant.workspaceIds,
      } satisfies ConfluentAuthExtra,
    }
  }

  // RFC 7009: revoking any token of a connection ends the connection.
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(request.token) },
      include: { grant: true },
    })
    if (!token || token.grant.clientId !== client.client_id) return
    await this.revokeGrant(token.grantId, token.grant.userId, 'client_revocation')
  }

  // What the consent screen shows: the application, the permissions requested that this account may
  // grant, and the workspaces it may allow the application to reach (E05.10). `null` if the request
  // is unknown, expired or already decided.
  async describeRequest(
    requestId: string,
    user: { id: string; role: string },
  ): Promise<OAuthConsentRequest | null> {
    const request = await this.prisma.oAuthAuthorizationRequest.findUnique({
      where: { id: requestId },
      include: { client: true },
    })
    if (!request || request.decidedAt || request.expiresAt.getTime() <= Date.now()) return null
    const options = await this.consentOptions(user)
    const metadata = request.client.metadata as { client_uri?: string }
    return {
      id: request.id,
      client: {
        name: request.client.name,
        // MCP spec: the redirect hostname MUST be shown to the user.
        redirectHost: new URL(request.redirectUri).host,
        clientUri: typeof metadata.client_uri === 'string' ? metadata.client_uri : null,
        verifiedByMetadataDocument: request.client.source === 'cimd',
      },
      // Effective permissions: writing implies reading on the server, so both are shown (R17). Only
      // what this account may grant: `forms:write` is never offered to whoever designs no form.
      scopes: grantableScopes(expandScopes(request.scopes), user, options)
        .sort()
        .map((scope) => ({ scope, label: SCOPE_LABELS[scope] ?? scope })),
      workspaces: options.workspaces,
      expiresAt: request.expiresAt.toISOString(),
    }
  }

  // The account's active memberships, read at consent time — the only workspaces it may allow an
  // application to reach, whatever its global role (an administrator chooses among the workspaces
  // it is a member of, like anyone).
  private async consentOptions(user: { id: string; role: string }): Promise<ConsentOptions> {
    const memberships = await this.members.listMine(user)
    return {
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        programName: m.workspace.programName ?? null,
        role: m.role,
      })),
      managesWorkspace: memberships.some((m) =>
        canManageWorkspace(user, { ...m, deactivatedAt: null }),
      ),
      // E06.09: a conseiller of a workspace it may allow (an administrator member of one included).
      reviewsCandidatures: memberships.some((m) => canReviewCandidatures(user, m)),
    }
  }

  // Step 2 — called by the consent screen (logged-in user). Returns where to send the browser.
  async decide(
    requestId: string,
    user: { id: string; role: string },
    approved: boolean,
    approvedScopes?: string[],
    approvedWorkspaceIds: string[] = [],
  ): Promise<string> {
    const userId = user.id
    const request = await this.prisma.oAuthAuthorizationRequest.findUnique({
      where: { id: requestId },
      include: { client: true },
    })
    if (!request || request.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRequestError('Authorization request expired, start again from the app')
    }
    // Checked BEFORE the request is consumed, so that the user can correct the choice (R13):
    // `undefined` keeps what was requested and this account may grant (a non-administrator never
    // grants `forms:write`); an explicitly empty, unknown or ungrantable list is refused. The same for
    // the workspaces (E05.10): only active memberships of this account, read now; none by default.
    const options = await this.consentOptions(user)
    const allowed = new Set(grantableScopes(expandScopes(request.scopes), user, options))
    const scopes =
      approvedScopes === undefined ? grantableScopes(request.scopes, user, options) : approvedScopes
    if (approved && (scopes.length === 0 || scopes.some((s) => !allowed.has(s)))) {
      throw new InvalidScopeError('Choose at least one of the requested permissions')
    }
    const offered = new Set(options.workspaces.map((w) => w.id))
    const workspaceIds = [...new Set(approvedWorkspaceIds)]
    if (approved && workspaceIds.some((id) => !offered.has(id))) {
      throw new InvalidRequestError('Choose workspaces among your active memberships')
    }
    const decided = await this.prisma.oAuthAuthorizationRequest.updateMany({
      where: { id: requestId, decidedAt: null },
      data: { decidedAt: new Date() },
    })
    if (decided.count !== 1) throw new InvalidRequestError('Authorization request already decided')

    const target = new URL(request.redirectUri)
    if (request.state) target.searchParams.set('state', request.state)
    // RFC 9207: tell the client which issuer answered (advertised in our metadata).
    target.searchParams.set('iss', this.issuer)
    if (!approved) {
      target.searchParams.set('error', 'access_denied')
      return target.toString()
    }
    const grant = await this.prisma.oAuthGrant.create({
      data: {
        userId,
        clientId: request.clientId,
        scopes,
        workspaceIds,
        resource: request.resource,
        expiresAt: new Date(Date.now() + GRANT_TTL_MS),
      },
    })
    const code = newOpaqueToken('cfl_code')
    await this.prisma.oAuthToken.create({
      data: {
        grantId: grant.id,
        kind: 'code',
        tokenHash: hashToken(code),
        scopes,
        codeChallenge: request.codeChallenge,
        redirectUri: request.redirectUri,
        expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
      },
    })
    await this.audit.record({
      actionType: 'oauth_grant_created',
      actorId: userId,
      metadata: {
        grantId: grant.id,
        clientId: request.clientId,
        clientName: request.client.name,
        scopes,
        workspaceIds,
      },
    })
    target.searchParams.set('code', code)
    return target.toString()
  }

  // Every AI connection of a user, for good (code review R16): used when the account is deactivated,
  // so that a later reactivation does not bring the former tokens back.
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    })
    let revoked = 0
    for (const { id } of grants) {
      if (await this.revokeGrant(id, userId, reason)) revoked++
    }
    return revoked
  }

  async revokeGrant(grantId: string, userId: string, reason: string): Promise<boolean> {
    const now = new Date()
    const revoked = await this.prisma.oAuthGrant.updateMany({
      where: { id: grantId, revokedAt: null },
      data: { revokedAt: now },
    })
    await this.prisma.oAuthToken.updateMany({
      where: { grantId, revokedAt: null },
      data: { revokedAt: now },
    })
    if (revoked.count === 1) {
      if (reason === 'refresh_token_reused') {
        this.logger.warn(`oauth refresh token replay, grant ${grantId} revoked`)
      }
      await this.audit.record({
        actionType:
          reason === 'refresh_token_reused' ? 'oauth_refresh_token_reused' : 'oauth_grant_revoked',
        actorId: userId,
        metadata: { grantId, reason },
      })
    }
    return revoked.count === 1
  }

  private async findLiveCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const code = await this.prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(authorizationCode) },
      include: { grant: true },
    })
    if (
      !code ||
      code.kind !== 'code' ||
      code.usedAt ||
      code.revokedAt ||
      code.expiresAt.getTime() <= Date.now() ||
      code.grant.clientId !== client.client_id ||
      code.grant.revokedAt
    ) {
      throw new InvalidGrantError('Invalid or expired authorization code')
    }
    return code
  }

  private async grantIsUsable(grant: {
    userId: string
    revokedAt: Date | null
    expiresAt: Date
  }): Promise<boolean> {
    if (grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return false
    const user = await this.prisma.user.findUnique({
      where: { id: grant.userId },
      select: { isActive: true, emailVerifiedAt: true },
    })
    return !!user && user.isActive && user.emailVerifiedAt !== null
  }

  private async issueTokens(
    db: Prisma.TransactionClient,
    grantId: string,
    scopes: string[],
  ): Promise<OAuthTokens> {
    const accessToken = newOpaqueToken('cfl_at')
    const refreshToken = newOpaqueToken('cfl_rt')
    const now = Date.now()
    await db.oAuthToken.create({
      data: {
        grantId,
        kind: 'access',
        tokenHash: hashToken(accessToken),
        scopes,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      },
    })
    await db.oAuthToken.create({
      data: {
        grantId,
        kind: 'refresh',
        tokenHash: hashToken(refreshToken),
        scopes,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
      },
    })
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    }
  }
}
