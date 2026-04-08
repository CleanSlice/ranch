import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Setup slices
import { PrismaModule } from './slices/setup/prisma/prisma.module';
import { HealthModule } from './slices/setup/health/health.module';

// Feature slices
import { AgentModule } from './slices/agent/agent.module';
import { TemplateModule } from './slices/template/template.module';
import { WorkflowModule } from './slices/workflow/workflow.module';
import { LogModule } from './slices/log/log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'dev'}`,
    }),

    // Setup slices
    PrismaModule,
    HealthModule,

    // Feature slices
    WorkflowModule,
    TemplateModule,
    AgentModule,
    LogModule,
  ],
})
export class AppModule {}
