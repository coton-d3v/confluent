import { Global, Module } from '@nestjs/common'
import { QuestionnairesController } from './questionnaires.controller'
import { QuestionnairesService } from './questionnaires.service'
import { FormsService } from './forms.service'
import { FormDraftsService } from './form-drafts.service'

@Global()
@Module({
  controllers: [QuestionnairesController],
  providers: [QuestionnairesService, FormsService, FormDraftsService],
  exports: [QuestionnairesService, FormsService, FormDraftsService],
})
export class QuestionnairesModule {}
