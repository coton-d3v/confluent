import { Global, Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { FormDesignAccess } from './form-design-access'
import { QuestionnairesController } from './questionnaires.controller'
import { QuestionnairesService } from './questionnaires.service'
import { FormsService } from './forms.service'
import { FormDraftsService } from './form-drafts.service'

@Global()
@Module({
  imports: [WorkspacesModule],
  controllers: [QuestionnairesController],
  providers: [QuestionnairesService, FormsService, FormDraftsService, FormDesignAccess],
  exports: [QuestionnairesService, FormsService, FormDraftsService],
})
export class QuestionnairesModule {}
