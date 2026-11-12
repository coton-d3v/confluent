import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { finalize, type Observable } from 'rxjs'

// ROADMAP E10.08 (U10): a file is held in the API's memory while it is received, checked and sent to
// the storage — about 35 MB for a 20 MB file, measured: 30 parallel uploads of one account took the
// process from 243 MB to 1 GB. The uploads a process receives at once are therefore bounded, per
// account (the site sends one file at a time per list) and in all, from before the body is buffered
// until the file is no longer held: beyond, `429` with `Retry-After`. The connection is kept, so that
// the browser reads the refusal and says it (Node reads the rest of the body and drops it, holding
// none of it). Per process: an API scaled to several processes multiplies the total, each process
// keeping its own memory bounded.
export const MAX_UPLOADS_PER_ACCOUNT = 3
export const MAX_UPLOADS_PER_PROCESS = 8
const RETRY_AFTER_SECONDS = 5

export class UploadSlots {
  private total = 0
  private readonly perAccount = new Map<string, number>()

  constructor(
    private readonly perAccountLimit = MAX_UPLOADS_PER_ACCOUNT,
    private readonly processLimit = MAX_UPLOADS_PER_PROCESS,
  ) {}

  // A slot for the account, released by the returned function (once, whatever happens); null when
  // the account or the process already receives as many uploads as allowed.
  acquire(accountId: string): (() => void) | null {
    const mine = this.perAccount.get(accountId) ?? 0
    if (mine >= this.perAccountLimit || this.total >= this.processLimit) return null
    this.perAccount.set(accountId, mine + 1)
    this.total += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.total -= 1
      const left = (this.perAccount.get(accountId) ?? 1) - 1
      if (left > 0) this.perAccount.set(accountId, left)
      else this.perAccount.delete(accountId)
    }
  }

  get inFlight(): number {
    return this.total
  }
}

// One count for the whole process: every upload route shares it.
export const uploadSlots = new UploadSlots()

// Outside the multipart interceptor (`@UseInterceptors(UploadSlotsInterceptor, FileInterceptor(…))`),
// after the authentication and the announced size (UploadSizeGuard): the slot is taken before any
// byte of the body is buffered, and given back only when nothing holds the file any more (R76):
//  * once its handling ends — stored, refused or failed — whether or not the client is still there:
//    a client that leaves after sending its file neither stops the handling nor frees its buffer;
//  * or when the connection closes before the body was received in full: the multipart never
//    reaches the handler, nothing runs for it.
// Released once whichever comes first (`UploadSlots.acquire`).
@Injectable()
export class UploadSlotsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const req = http.getRequest<Request & { user?: { id: string } }>()
    const res = http.getResponse<Response>()
    // Fail closed: an upload route is never public, an anonymous request gets no slot.
    const release = req.user ? uploadSlots.acquire(req.user.id) : null
    if (!release) {
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS))
      throw new HttpException(
        {
          code: 'TOO_MANY_UPLOADS',
          message:
            'Trop de fichiers en cours d’envoi : attendez la fin des envois en cours, puis réessayez.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    res.once('close', () => {
      if (!req.complete) release()
    })
    return next.handle().pipe(finalize(release))
  }
}
