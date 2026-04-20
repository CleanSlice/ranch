import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Setup slices
import { PrismaModule } from './slices/setup/prisma/prisma.module';
import { HealthModule } from './slices/setup/health/health.module';
import { InitModule } from './slices/setup/init/init.module';

// Feature slices
import { AgentModule } from './slices/agent/agent/agent.module';
import { TemplateModule } from './slices/agent/template/template.module';
import { WorkflowModule } from './slices/workflow/workflow.module';
import { LogModule } from './slices/log/log.module';
import { UserModule } from './slices/user/user/user.module';
import { AuthModule } from './slices/user/auth/auth.module';
import { SettingModule } from './slices/setting/setting.module';
import { BridleModule } from './slices/bridle/bridle.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'dev'}`,
    }),

    // Setup slices
    PrismaModule,
    HealthModule,
    InitModule,

    // Feature slices
    WorkflowModule,
    TemplateModule,
    AgentModule,
    LogModule,
    UserModule,
    AuthModule,
    SettingModule,
    BridleModule,
  ],
})
export class AppModule {}
