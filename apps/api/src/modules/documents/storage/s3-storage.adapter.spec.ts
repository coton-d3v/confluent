import { S3ServiceException } from '@aws-sdk/client-s3'
import { attachmentDisposition, isQuotaError, S3StorageAdapter } from './s3-storage.adapter'
import { StorageQuotaExceededError, StoredObjectMissingError } from './storage.adapter'

function s3Error(name: string, status: number, message = name) {
  return new S3ServiceException({
    name,
    $fault: 'client',
    $metadata: { httpStatusCode: status },
    message,
  })
}

function adapter(send: jest.Mock) {
  const signer = jest.fn().mockResolvedValue('https://s3.test/signed')
  return { storage: new S3StorageAdapter({ send } as never, 'bucket', signer), signer }
}

describe('S3StorageAdapter', () => {
  it('turns the Garage quota refusal into StorageQuotaExceededError', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(s3Error('AccessDenied', 403, 'Forbidden: Bucket size quota is reached'))
    await expect(
      adapter(send).storage.upload('k', Buffer.from('x'), 'text/plain'),
    ).rejects.toBeInstanceOf(StorageQuotaExceededError)
  })

  it('keeps any other refusal (e.g. wrong credentials) as an error, not a full bucket', async () => {
    const send = jest.fn().mockRejectedValue(s3Error('AccessDenied', 403, 'Forbidden'))
    const err = await adapter(send)
      .storage.upload('k', Buffer.from('x'), 'text/plain')
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StorageQuotaExceededError)
    expect(err).toBeInstanceOf(S3ServiceException)
  })

  it('checks the object exists before signing, and reports a missing one', async () => {
    const send = jest.fn().mockRejectedValue(s3Error('NotFound', 404))
    const { storage, signer } = adapter(send)
    await expect(storage.getSignedUrl('k', { filename: 'a.pdf' })).rejects.toBeInstanceOf(
      StoredObjectMissingError,
    )
    expect(signer).not.toHaveBeenCalled()
  })

  it('does not take an unreachable storage for a missing object', async () => {
    const send = jest.fn().mockRejectedValue(s3Error('InternalError', 500))
    const err = await adapter(send)
      .storage.getSignedUrl('k', { filename: 'a.pdf' })
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StoredObjectMissingError)
  })

  it('reads an object’s content, and reports a missing one', async () => {
    const send = jest.fn().mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([0x25, 0x50])) },
    })
    await expect(adapter(send).storage.read('k')).resolves.toEqual(Buffer.from('%P'))
    const missing = jest.fn().mockRejectedValue(s3Error('NoSuchKey', 404))
    await expect(adapter(missing).storage.read('k')).rejects.toBeInstanceOf(
      StoredObjectMissingError,
    )
    const down = jest.fn().mockRejectedValue(s3Error('InternalError', 500))
    const err = await adapter(down)
      .storage.read('k')
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StoredObjectMissingError)
  })

  it('signs a download as an attachment for at most 15 minutes', async () => {
    const send = jest.fn().mockResolvedValue({})
    const { storage, signer } = adapter(send)
    await expect(
      storage.getSignedUrl('k', { filename: 'bilan.pdf', ttlSeconds: 3600 }),
    ).resolves.toBe('https://s3.test/signed')
    const [command, ttl] = signer.mock.calls[0] as [{ input: Record<string, string> }, number]
    expect(ttl).toBe(900)
    expect(command.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'k',
      ResponseContentDisposition: expect.stringMatching(/^attachment; /),
    })
  })
})

describe('isQuotaError', () => {
  it('recognises a dedicated quota code', () => {
    expect(isQuotaError(s3Error('QuotaExceeded', 400))).toBe(true)
    expect(isQuotaError(new Error('quota'))).toBe(false)
  })
})

describe('attachmentDisposition', () => {
  it('keeps the exact UTF-8 name and an ASCII fallback without quotes', () => {
    expect(attachmentDisposition('Prévisionnel "2026" (v2).xlsx')).toBe(
      'attachment; filename="Previsionnel _2026_ (v2).xlsx"; ' +
        "filename*=UTF-8''Pr%C3%A9visionnel%20%222026%22%20%28v2%29.xlsx",
    )
  })
})
