import { Injectable } from '@nestjs/common'
import { StoredObjectMissingError, type StorageAdapter } from './storage.adapter'

// Tests and local experiments only (STORAGE_DRIVER=memory, refused in production): objects are lost
// when the process stops.
@Injectable()
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, { buffer: Buffer; mimetype: string }>()

  upload(key: string, buffer: Buffer, mimetype: string): Promise<void> {
    this.store.set(key, { buffer, mimetype })
    return Promise.resolve()
  }

  getSignedUrl(key: string): Promise<string> {
    if (!this.store.has(key)) return Promise.reject(new StoredObjectMissingError(key))
    return Promise.resolve(`memory://${key}`)
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key))
  }

  delete(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }

  check(): Promise<void> {
    return Promise.resolve()
  }
}
