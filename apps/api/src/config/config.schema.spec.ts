import { validateConfig } from './config.schema'

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
