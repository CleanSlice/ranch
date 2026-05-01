import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Setup slices
import { PrismaModule } from './slices/setup/prisma/prisma.module';
import { HealthModule } from './slices/setup/health/health.module';
import { InitModule } from './slices/setup/init/init.module';

// Feature slices
import { AgentModule } from './slices/agent/agent/agent.module';
import { TemplateModule } from './slices/agent/template/template.module';
import { TemplateFileModule } from './slices/agent/templateFile/templateFile.module';
import { FileModule } from './slices/agent/file/file.module';
import { SecretModule } from './slices/agent/secret/secret.module';
import { WorkflowModule } from './slices/workflow/workflow.module';
import { LogModule } from './slices/log/log.module';
import { UserModule } from './slices/user/user/user.module';
import { AuthModule } from './slices/user/auth/auth.module';
import { SettingModule } from './slices/setting/setting.module';
import { BridleModule } from './slices/bridle/bridle.module';
import { LlmModule } from './slices/llm/llm.module';
import { UsageModule } from './slices/usage/usage.module';
import { ReinsModule } from './slices/reins/reins.module';
import { SkillModule } from './slices/skill/skill.module';

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
    TemplateFileModule,
    AgentModule,
    FileModule,
    SecretModule,
    LogModule,
    UserModule,
    AuthModule,
    SettingModule,
    BridleModule,
    LlmModule,
    UsageModule,
    ReinsModule,
    SkillModule,
  ],
})
export class AppModule {}
