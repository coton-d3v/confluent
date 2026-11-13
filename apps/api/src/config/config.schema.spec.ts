import { DEFAULT_SWAGGER_PASSWORD, swaggerMode, validateConfig } from './config.schema'

const validEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  PORT: '3000',
  NODE_ENV: 'development',
  FRONTEND_URL: 'http://localhost:5173',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: 'noreply@confluent.local',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'confluent-dev',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  SWAGGER_ENABLED: 'true',
  SWAGGER_USER: 'admin',
  SWAGGER_PASSWORD: 'swagger-dev-password',
}

describe('validateConfig', () => {
  it('accepts a fully populated env record and returns a typed config', () => {
    const cfg = validateConfig(validEnv)
    expect(cfg.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db')
    expect(cfg.PORT).toBe(3000)
    expect(cfg.NODE_ENV).toBe('development')
  })

  it('throws a descriptive error when DATABASE_URL is missing', () => {
    expect(() => validateConfig({})).toThrow(/DATABASE_URL/)
  })

  it('throws when JWT_SECRET is shorter than 32 characters', () => {
    const raw = { ...validEnv, JWT_SECRET: 'short' }
    expect(() => validateConfig(raw)).toThrow(/JWT_SECRET/)
  })

  it('coerces PORT and SMTP_PORT from string to number', () => {
    const cfg = validateConfig({ ...validEnv, PORT: '8080', SMTP_PORT: '2525' })
    expect(cfg.PORT).toBe(8080)
    expect(cfg.SMTP_PORT).toBe(2525)
  })

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })
})

describe('STORAGE_DRIVER', () => {
  it('defaults to the S3 storage', () => {
    expect(validateConfig(validEnv).STORAGE_DRIVER).toBe('s3')
  })

  it('refuses the in-memory storage in production, where every document would be lost', () => {
    expect(() =>
      validateConfig({ ...validEnv, NODE_ENV: 'production', STORAGE_DRIVER: 'memory' }),
    ).toThrow(/STORAGE_DRIVER/)
    expect(validateConfig({ ...validEnv, STORAGE_DRIVER: 'memory' }).STORAGE_DRIVER).toBe('memory')
  })
})

describe('public addresses (E10.11)', () => {
  it('drops a trailing slash from FRONTEND_URL, an origin CORS compares exactly', () => {
    const cfg = validateConfig({ ...validEnv, FRONTEND_URL: 'https://confluent.example.org/' })
    expect(cfg.FRONTEND_URL).toBe('https://confluent.example.org')
    expect(validateConfig(validEnv).FRONTEND_URL).toBe('http://localhost:5173')
  })

  it('drops a trailing slash from API_PUBLIC_URL', () => {
    const cfg = validateConfig({ ...validEnv, API_PUBLIC_URL: 'https://api.example.org//' })
    expect(cfg.API_PUBLIC_URL).toBe('https://api.example.org')
  })
})

describe('swaggerMode (E10.11)', () => {
  const prod = { ...validEnv, NODE_ENV: 'production' }
  const withoutSwagger: Record<string, string | undefined> = {
    ...prod,
    SWAGGER_PASSWORD: undefined,
    SWAGGER_ENABLED: undefined,
  }

  it('never serves Swagger in production behind the published default password', () => {
    expect(validateConfig(withoutSwagger).SWAGGER_PASSWORD).toBe(DEFAULT_SWAGGER_PASSWORD)
    expect(swaggerMode(validateConfig(withoutSwagger))).toBe('refused-default-password')
    expect(
      swaggerMode(validateConfig({ ...prod, SWAGGER_PASSWORD: DEFAULT_SWAGGER_PASSWORD })),
    ).toBe('refused-default-password')
  })

  it('serves it behind HTTP Basic in production with an operator-chosen password', () => {
    expect(swaggerMode(validateConfig(prod))).toBe('basic-auth')
  })

  it('serves it open in development, and not at all when disabled', () => {
    expect(swaggerMode(validateConfig({ ...validEnv, SWAGGER_PASSWORD: undefined }))).toBe('open')
    expect(swaggerMode(validateConfig({ ...prod, SWAGGER_ENABLED: 'false' }))).toBe('off')
    expect(swaggerMode(validateConfig({ ...withoutSwagger, SWAGGER_ENABLED: 'false' }))).toBe('off')
  })
})
