import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'

// The web app is on another origin: it may only read the response headers listed here. It needs
// `Retry-After` (429 of the rate limiter, 503) to tell the person when to try again (code review R03).
export function corsOptions(frontendUrl: string): CorsOptions {
  return { origin: frontendUrl, credentials: true, exposedHeaders: ['Retry-After'] }
}
