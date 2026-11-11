import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  MAX_SIGNED_URL_SECONDS,
  StorageQuotaExceededError,
  StoredObjectMissingError,
  type DownloadOptions,
  type StorageAdapter,
} from './storage.adapter'

export interface S3Settings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export function createS3Client(s: S3Settings): S3Client {
  return new S3Client({
    endpoint: s.endpoint,
    // Garage signs with its own region name ("garage"): any other value fails with
    // SignatureDoesNotMatch. Path-style addressing: no DNS entry per bucket.
    region: s.region,
    forcePathStyle: true,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // A stalled storage must not hold a request (or a whole dossier listing) indefinitely.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  })
}

type Sender = Pick<S3Client, 'send'>

// S3-compatible object storage (Garage in dev and production, ROADMAP E02.03/E02.04).
export class S3StorageAdapter implements StorageAdapter {
  constructor(
    private readonly client: Sender,
    private readonly bucket: string,
    // Signing only needs the client configuration; kept separate so tests can fake `send`.
    private readonly signer: (command: GetObjectCommand, expiresIn: number) => Promise<string>,
  ) {}

  static fromSettings(s: S3Settings): S3StorageAdapter {
    const client = createS3Client(s)
    return new S3StorageAdapter(client, s.bucket, (command, expiresIn) =>
      getSignedUrl(client, command, { expiresIn }),
    )
  }

  async upload(key: string, buffer: Buffer, mimetype: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
          ContentLength: buffer.byteLength,
        }),
      )
    } catch (err) {
      if (isQuotaError(err)) throw new StorageQuotaExceededError()
      throw err
    }
  }

  async getSignedUrl(key: string, options: DownloadOptions): Promise<string> {
    // Signing never contacts the storage: without this check a lost file would get a URL that
    // fails in the browser instead of being reported as missing.
    if (!(await this.exists(key))) throw new StoredObjectMissingError(key)
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Always downloaded, never rendered on the storage origin, under its original name.
      ResponseContentDisposition: attachmentDisposition(options.filename),
    })
    const ttl = Math.min(options.ttlSeconds ?? MAX_SIGNED_URL_SECONDS, MAX_SIGNED_URL_SECONDS)
    return this.signer(command, ttl)
  }

  async read(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      if (!res.Body) throw new StoredObjectMissingError(key)
      return Buffer.from(await res.Body.transformToByteArray())
    } catch (err) {
      if (statusOf(err) === 404) throw new StoredObjectMissingError(key)
      throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch (err) {
      if (statusOf(err) === 404) return false
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }
}

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
}

// Garage answers a write beyond the bucket quota with 403 AccessDenied « Bucket size quota is
// reached »; other S3 implementations use a dedicated code. A plain 403 (bad credentials, missing
// right) is not a quota problem and must stay an error.
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { Code?: string }).Code ?? err.name
  return /quota/i.test(code) || (statusOf(err) === 403 && /quota/i.test(err.message))
}

// RFC 6266: an ASCII fallback for old clients, and the exact UTF-8 name in `filename*`.
export function attachmentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
