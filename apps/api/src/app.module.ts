import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { AppController } from './app.controller'
import { validateConfig } from './config/config.schema'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuditModule } from './modules/audit/audit.module'
import { ShareLinksModule } from './modules/share-links/share-links.module'
import { DossiersModule } from './modules/dossiers/dossiers.module'
import { AnswersModule } from './modules/answers/answers.module'
import { QuestionnairesModule } from './modules/questionnaires/questionnaires.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { AdminModule } from './modules/admin/admin.module'
import { OAuthModule } from './modules/oauth/oauth.module'
import { McpModule } from './modules/mcp/mcp.module'
import { CompanyTransfersModule } from './modules/company-transfers/company-transfers.module'
import { CandidaturesModule } from './modules/candidatures/candidatures.module'
import { FundingSourcesModule } from './modules/funding-sources/funding-sources.module'
import { FundingPlansModule } from './modules/funding-plans/funding-plans.module'
import { EligibilitiesModule } from './modules/eligibilities/eligibilities.module'
import { SupportPathsModule } from './modules/support-paths/support-paths.module'
import { InterventionsModule } from './modules/interventions/interventions.module'
import { PoolPublicationsModule } from './modules/pool-publications/pool-publications.module'
import { OpportunitiesModule } from './modules/opportunities/opportunities.module'
import { RateLimitAuditInterceptor } from './common/interceptors/rate-limit-audit.interceptor'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    ShareLinksModule,
    QuestionnairesModule,
    DossiersModule,
    AnswersModule,
    DocumentsModule,
    AnalyticsModule,
    AdminModule,
    OAuthModule,
    McpModule,
    CompanyTransfersModule,
    CandidaturesModule,
    FundingSourcesModule,
    FundingPlansModule,
    EligibilitiesModule,
    SupportPathsModule,
    InterventionsModule,
    PoolPublicationsModule,
    OpportunitiesModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RateLimitAuditInterceptor },
  ],
})
export class AppModule {}
