export const STORAGE_TOKEN = Symbol('STORAGE_ADAPTER')

// Signed download URLs never live longer than this (the dev and production buckets are private).
export const MAX_SIGNED_URL_SECONDS = 15 * 60

// The object a document row points to is not in the bucket: the file is lost and must be uploaded
// again (e.g. documents uploaded while files were only kept in memory).
export class StoredObjectMissingError extends Error {
  constructor(key: string) {
    super(`Stored object not found: ${key}`)
    this.name = 'StoredObjectMissingError'
  }
}

// The bucket refused a write because its quota is reached.
export class StorageQuotaExceededError extends Error {
  constructor() {
    super('Storage quota reached')
    this.name = 'StorageQuotaExceededError'
  }
}

export interface DownloadOptions {
  // Name proposed to the browser (the object key itself is opaque).
  filename: string
  ttlSeconds?: number
}

export interface StorageAdapter {
  // Throws StorageQuotaExceededError when the bucket is full.
  upload(key: string, buffer: Buffer, mimetype: string): Promise<void>
  // URL that downloads the object as an attachment. Throws StoredObjectMissingError when the object
  // does not exist; any other error means the storage could not be reached.
  getSignedUrl(key: string, options: DownloadOptions): Promise<string>
  // Whether the object exists; throws when the storage cannot answer.
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  // Throws when the bucket cannot be reached with the configured credentials.
  check(): Promise<void>
}
