import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../config/config.schema'
import { RetentionService } from './retention.service'

// The first run waits this long after the start, so as not to slow it down.
const FIRST_RUN_DELAY_MS = 60_000

// ROADMAP E10.10: runs the retention job every `RETENTION_PURGE_INTERVAL_MINUTES` (6 h by default),
// in each instance — the job's advisory lock keeps two runs from purging at once. No job runner in
// this version: a timer that never holds the process open; a failed run is logged and the next one
// starts over (the job is idempotent).
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionScheduler.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly retention: RetentionService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    const minutes = this.config.get('RETENTION_PURGE_INTERVAL_MINUTES', { infer: true })
    if (minutes === 0 || this.config.get('NODE_ENV', { infer: true }) === 'test') return
    const run = () => {
      this.retention.purge().catch((err: Error) => {
        this.logger.warn(`retention purge failed: ${err.message}`)
      })
    }
    const first = setTimeout(() => {
      run()
      this.timer = setInterval(run, minutes * 60_000)
      this.timer.unref()
    }, FIRST_RUN_DELAY_MS)
    first.unref()
    this.timer = first
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
