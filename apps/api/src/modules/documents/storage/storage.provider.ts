import { Logger, type Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../../config/config.schema'
import { MemoryStorageAdapter } from './memory-storage.adapter'
import { S3StorageAdapter } from './s3-storage.adapter'
import { STORAGE_TOKEN, type StorageAdapter } from './storage.adapter'

type StorageConfig = Pick<
  AppConfig,
  'STORAGE_DRIVER' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY'
>

// Shared with the operator scripts (documents audit), which run outside Nest.
export function createStorageAdapter(c: StorageConfig): StorageAdapter {
  if (c.STORAGE_DRIVER === 'memory') return new MemoryStorageAdapter()
  return S3StorageAdapter.fromSettings({
    endpoint: c.S3_ENDPOINT,
    region: c.S3_REGION,
    bucket: c.S3_BUCKET,
    accessKeyId: c.S3_ACCESS_KEY,
    secretAccessKey: c.S3_SECRET_KEY,
  })
}

export const storageProvider: Provider = {
  provide: STORAGE_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): StorageAdapter => {
    const driver = config.get('STORAGE_DRIVER', { infer: true })
    if (driver === 'memory') {
      new Logger('Storage').warn('Documents are kept in memory: they are lost when the API stops.')
    }
    return createStorageAdapter({
      STORAGE_DRIVER: driver,
      S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
      S3_REGION: config.get('S3_REGION', { infer: true }),
      S3_BUCKET: config.get('S3_BUCKET', { infer: true }),
      S3_ACCESS_KEY: config.get('S3_ACCESS_KEY', { infer: true }),
      S3_SECRET_KEY: config.get('S3_SECRET_KEY', { infer: true }),
    })
  },
}
