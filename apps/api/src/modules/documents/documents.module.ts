import { Module } from '@nestjs/common'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { DossiersModule } from '../dossiers/dossiers.module'
import { storageProvider } from './storage/storage.provider'
import { STORAGE_TOKEN } from './storage/storage.adapter'
import { StorageCheck } from './storage/storage-check'

@Module({
  imports: [DossiersModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, storageProvider, StorageCheck],
  // The bucket is shared with the workspace logos (E05.01).
  exports: [DocumentsService, STORAGE_TOKEN],
})
export class DocumentsModule {}
