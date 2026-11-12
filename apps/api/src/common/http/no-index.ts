import type { NextFunction, Request, Response } from 'express'
import { ROBOTS_CLOSED } from '@confluent/shared'

// ROADMAP E09.06: nothing the API answers is a page for search engines — the public page's JSON, its
// logo, a refusal, the OAuth metadata alike —, so every answer says `X-Robots-Tag: noindex,
// nofollow`. Whether a workspace's public page may be indexed is the site's page to say
// (@confluent/shared `publicPageRobots`); this header does not stop search engines from reading the
// API to show that page. Mounted by main.ts ahead of everything (errors included), and by `AppModule`
// on the public routes, so that the tests, which build the application without main.ts, see it there.
export function noIndex(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', ROBOTS_CLOSED)
  next()
}
