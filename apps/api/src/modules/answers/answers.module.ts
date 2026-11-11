import { Module } from '@nestjs/common'
import { AnswersController } from './answers.controller'
import { AnswerSourcesService } from './answer-sources.service'
import { AnswersService } from './answers.service'
import { ClassificationModule } from '../classification/classification.module'
import { DocumentsModule } from '../documents/documents.module'
import { DossiersModule } from '../dossiers/dossiers.module'

@Module({
  imports: [DossiersModule, ClassificationModule, DocumentsModule],
  controllers: [AnswersController],
  providers: [AnswersService, AnswerSourcesService],
  exports: [AnswersService, AnswerSourcesService],
})
export class AnswersModule {}
