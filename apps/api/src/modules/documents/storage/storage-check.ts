import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { STORAGE_TOKEN, type StorageAdapter } from './storage.adapter'

// An unreachable bucket (wrong endpoint, region or credentials) is reported at startup rather than
// on the first upload. The API still starts: answers and dossiers do not depend on it.
@Injectable()
export class StorageCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('Storage')

  constructor(@Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.storage.check()
      this.logger.log('Document storage reachable.')
    } catch (err) {
      this.logger.error(
        `Document storage unreachable: ${(err as Error).name} ${(err as Error).message}`,
      )
    }
  }
}
