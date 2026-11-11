import {
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  mixin,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { MAX_UPLOAD_BYTES } from './documents.service'

// Room for the multipart boundaries, part headers and file name around the file itself.
export const MULTIPART_ALLOWANCE_BYTES = 1024 * 1024

// The multipart limit stops buffering at the file limit but then reads (and discards) the rest of
// the body before answering, however large it is. This guard answers from the announced size, before
// any byte of the body is read, and closes the connection so the client stops sending. A request
// without a size (chunked) is refused: browsers always announce it.
export function createUploadSizeGuard(
  maxFileBytes: number,
  tooLargeMessage: string,
): Type<CanActivate> {
  @Injectable()
  class SizeGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const http = context.switchToHttp()
      const req = http.getRequest<Request>()
      const header = req.headers['content-length']
      if (header === undefined) {
        closeAfterResponse(http.getResponse<Response>())
        throw new HttpException(
          { code: 'LENGTH_REQUIRED', message: 'La taille du fichier envoyé doit être annoncée.' },
          HttpStatus.LENGTH_REQUIRED,
        )
      }
      if (Number(header) > maxFileBytes + MULTIPART_ALLOWANCE_BYTES) {
        closeAfterResponse(http.getResponse<Response>())
        throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: tooLargeMessage })
      }
      return true
    }
  }
  return mixin(SizeGuard)
}

// Otherwise Node keeps the connection alive by reading the whole unread body after the response.
function closeAfterResponse(res: Response): void {
  res.setHeader('Connection', 'close')
}

export const UploadSizeGuard = createUploadSizeGuard(
  MAX_UPLOAD_BYTES,
  'Fichier trop volumineux : 20 Mo maximum.',
)
