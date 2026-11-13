import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CompaniesModule } from '../companies/companies.module'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { AccountDeletionService } from './account-deletion.service'
import { AdminDeletionRequestsController } from './admin-deletion-requests.controller'
import { MyDataController } from './my-data.controller'
import { PersonalDataExportService } from './personal-data-export.service'
import { RetentionScheduler } from './retention.scheduler'
import { RetentionService } from './retention.service'
import { StorageCleanupService } from './storage-cleanup.service'

// ROADMAP E10.10: personal data — export, deletion of an account, retention.
@Module({
  imports: [AuthModule, CompaniesModule, DocumentsModule, NotificationsModule, OpportunitiesModule],
  controllers: [MyDataController, AdminDeletionRequestsController],
  providers: [
    PersonalDataExportService,
    AccountDeletionService,
    StorageCleanupService,
    RetentionService,
    RetentionScheduler,
  ],
  exports: [RetentionService, StorageCleanupService],
})
export class PrivacyModule {}
