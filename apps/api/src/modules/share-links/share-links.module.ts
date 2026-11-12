import { Module } from '@nestjs/common'
import { ShareLinksController } from './share-links.controller'
import { ShareLinksService } from './share-links.service'
import { ShareLinkGuard } from '../auth/guards/share-link.guard'
import { DossiersModule } from '../dossiers/dossiers.module'
import { DocumentsModule } from '../documents/documents.module'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { AuthModule } from '../auth/auth.module'
import { ReadingSessionsModule } from '../reading-sessions/reading-sessions.module'

@Module({
  imports: [
    DossiersModule,
    DocumentsModule,
    AuthModule,
    QuestionnairesModule,
    ReadingSessionsModule,
  ],
  controllers: [ShareLinksController],
  providers: [ShareLinksService, ShareLinkGuard],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
