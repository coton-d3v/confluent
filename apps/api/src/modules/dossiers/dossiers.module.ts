import { Module } from '@nestjs/common'
import { CompanyDossiersController, DossiersController } from './dossiers.controller'
import { DossiersService } from './dossiers.service'
import { ClassificationModule } from '../classification/classification.module'
import { CompaniesModule } from '../companies/companies.module'

@Module({
  imports: [ClassificationModule, CompaniesModule],
  controllers: [DossiersController, CompanyDossiersController],
  providers: [DossiersService],
  exports: [DossiersService],
})
export class DossiersModule {}
