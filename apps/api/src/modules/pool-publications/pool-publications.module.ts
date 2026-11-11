import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { PoolPublicationsController } from './pool-publications.controller'
import { PoolPublicationsService } from './pool-publications.service'

// ROADMAP E07.02: a financing request published in the pool (« vivier ») of a workspace it is
// presented to, with its owner's explicit consent.
@Module({
  imports: [CandidaturesModule, DossiersModule],
  controllers: [PoolPublicationsController],
  providers: [PoolPublicationsService],
})
export class PoolPublicationsModule {}
