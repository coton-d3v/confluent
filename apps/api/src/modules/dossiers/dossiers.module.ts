import { Module } from '@nestjs/common'
import { DossiersController } from './dossiers.controller'
import { DossiersService } from './dossiers.service'
import { ClassificationModule } from '../classification/classification.module'
import { CompaniesModule } from '../companies/companies.module'

@Module({
  imports: [ClassificationModule, CompaniesModule],
  controllers: [DossiersController],
  providers: [DossiersService],
  exports: [DossiersService],
})
export class DossiersModule {}
