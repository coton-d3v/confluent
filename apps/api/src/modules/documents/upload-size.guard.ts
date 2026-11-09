import {
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { MAX_UPLOAD_BYTES } from './documents.service'

// Room for the multipart boundaries, part headers and file name around the file itself.
export const MULTIPART_ALLOWANCE_BYTES = 1024 * 1024

// The multipart limit stops buffering at 20 MB but then reads (and discards) the rest of the body
// before answering, however large it is. This guard answers from the announced size, before any byte
// of the body is read, and closes the connection so the client stops sending. A request without a
// size (chunked) is refused: browsers always announce it.
@Injectable()
export class UploadSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp()
    const req = http.getRequest<Request>()
    const header = req.headers['content-length']
    if (header === undefined) {
      this.closeAfterResponse(http.getResponse<Response>())
      throw new HttpException(
        { code: 'LENGTH_REQUIRED', message: 'La taille du fichier envoyé doit être annoncée.' },
        HttpStatus.LENGTH_REQUIRED,
      )
    }
    if (Number(header) > MAX_UPLOAD_BYTES + MULTIPART_ALLOWANCE_BYTES) {
      this.closeAfterResponse(http.getResponse<Response>())
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Fichier trop volumineux : 20 Mo maximum.',
      })
    }
    return true
  }

  // Otherwise Node keeps the connection alive by reading the whole unread body after the response.
  private closeAfterResponse(res: Response): void {
    res.setHeader('Connection', 'close')
  }
}
