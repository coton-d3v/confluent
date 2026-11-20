# Story 6.5: Rate Limiting & Security Hardening

Status: done

## Story

As the platform operator,
I want rate limiting and security headers applied to the API,
so that brute-force enumeration and common web vulnerabilities are mitigated.

## Acceptance Criteria

1. `@nestjs/throttler` is installed and applied globally via `ThrottlerModule.forRoot` with a default of 100 req/60s; a tighter override of 10 req/60s targets `GET /v1/auth/verify`, `POST /v1/auth/magic-link`, and `GET /v1/shares/:token` via the `@Throttle()` decorator. Returns `429 Too Many Requests` with `{ error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded.' } }` when exceeded.
2. A `RateLimitAuditInterceptor` catches 429 responses and records them via `AuditService` with `action_type: 'rate_limit_exceeded'` (schema extension: add `rate_limit_exceeded` and `share_link_access_denied` to the `audit_action` enum), IP (`req.ip`, which resolves X-Forwarded-For when `app.set('trust proxy', 1)` is on — enabled in `main.ts`), and path. Because `audit_action` is a Prisma enum, the `schema.prisma` enum list gets two new members; the Zod `auditActionSchema` gets the same; no other consumer breaks (enums widen).
3. `helmet` middleware is mounted via `app.use(helmet())` in `main.ts`. Default helmet directives include `x-content-type-options: nosniff`, `x-frame-options: DENY`, `strict-transport-security` (prod only via NODE_ENV check), and a permissive `content-security-policy` acceptable for a JSON API.
4. CORS is restricted to `FRONTEND_URL` only (already set in 6.2; re-verified here via an e2e that asserts a foreign-origin request does not receive `Access-Control-Allow-Origin`).
5. The `ShareLinkGuard` writes a `share_link_access_denied` audit entry on every deny path (unknown/revoked/expired/pending/error), with a SHA-256 hash of the raw token (not the raw token) and the IP. Uses the `AuditService` which already swallows errors.
6. Verification sweep typecheck/lint/test/test:e2e/turbo all green.

## Tasks

- [ ] Install `@nestjs/throttler` + `helmet`
- [ ] Extend `audit_action` (Prisma + Zod schema)
- [ ] `ThrottlerModule` with global + per-route overrides
- [ ] `RateLimitAuditInterceptor`
- [ ] `helmet()` + `trust proxy` in `main.ts`
- [ ] `ShareLinkGuard` records deny audit (hashed token)
- [ ] Tests
- [ ] Commit

## Dev Notes

- Throttler storage is in-memory by default (per-process); good enough for V1 single-server deployment. Redis-backed storage deferred to Phase 2.
- Hash deny tokens with `crypto.createHash('sha256').update(token).digest('hex')`.

## Dev Agent Record

### File List
