import { z, ZodError } from 'zod'

export const configSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    FRONTEND_URL: z.string().url(),
    // Public base URL of this API (OAuth issuer; the MCP endpoint is `${API_PUBLIC_URL}/mcp`).
    API_PUBLIC_URL: z
      .string()
      .url()
      .default('http://localhost:3000')
      .transform((v) => v.replace(/\/+$/, '')),
    // Extra browser origins allowed to call /mcp (comma-separated). Server-to-server MCP clients
    // (Claude, ChatGPT) send no Origin header and are not affected.
    MCP_ALLOWED_ORIGINS: z.string().optional().default(''),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    SMTP_FROM: z.string().email(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    // `memory` keeps documents in the process (tests only): refused in production below.
    STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    SWAGGER_ENABLED: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(true),
    SWAGGER_USER: z.string().min(1).default('admin'),
    SWAGGER_PASSWORD: z.string().min(8).default('change-me-in-prod-min-8-chars'),
    // E10.10: how often the retention job runs (minutes); 0 turns it off. Never in tests.
    RETENTION_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10_080).default(360),
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.STORAGE_DRIVER === 'memory'), {
    path: ['STORAGE_DRIVER'],
    message: 'memory storage loses every document on restart and is refused in production',
  })

export type AppConfig = z.infer<typeof configSchema>

export function validateConfig(raw: Record<string, unknown>): AppConfig {
  try {
    return configSchema.parse(raw)
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      throw new Error(`Invalid configuration: ${details}`)
    }
    throw err
  }
}
