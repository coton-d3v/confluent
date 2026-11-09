import { Module } from '@nestjs/common'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { DossiersModule } from '../dossiers/dossiers.module'
import { storageProvider } from './storage/storage.provider'
import { StorageCheck } from './storage/storage-check'

@Module({
  imports: [DossiersModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, storageProvider, StorageCheck],
  exports: [DocumentsService],
})
export class DocumentsModule {}
