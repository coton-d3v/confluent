import { Module } from '@nestjs/common'
import { ClassificationRulesService } from './classification-rules.service'
import { ClassificationService } from './classification.service'
import { ReclassificationService } from './reclassification.service'

@Module({
  providers: [ClassificationService, ClassificationRulesService, ReclassificationService],
  exports: [ClassificationService, ClassificationRulesService, ReclassificationService],
})
export class ClassificationModule {}
