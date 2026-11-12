import type { NextFunction, Request, Response } from 'express'

// The routes anyone reads without an account (`/v1/public/**`, ROADMAP E09): mounted on them by
// `AppModule`, path-wide, so that a public route added later is covered without being named.
export const PUBLIC_ROUTES = 'public/*path'

// ROADMAP E09.03: what the public reads changes with consents, publications and moderation, and must
// be gone at the next read once withdrawn, paused or hidden — so no cache may keep it: neither a
// browser nor any shared cache (proxy, CDN). Set before the route runs, so that every answer carries
// it, refusals (`404`, `429`) included. A route may replace it once it answers (the logo, versioned by
// its URL, keeps a short shared cache).
export function publicNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}
