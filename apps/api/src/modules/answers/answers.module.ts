import { Module } from '@nestjs/common'
import { AnswersController } from './answers.controller'
import { AnswersService } from './answers.service'
import { ClassificationModule } from '../classification/classification.module'
import { DossiersModule } from '../dossiers/dossiers.module'

@Module({
  imports: [DossiersModule, ClassificationModule],
  controllers: [AnswersController],
  providers: [AnswersService],
  exports: [AnswersService],
})
export class AnswersModule {}
