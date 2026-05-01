import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { SettingModule } from '#/setting/setting.module';
import { IKnowledgeConfigService } from './domain/knowledgeConfig.service';
import { KnowledgeConfigService } from './data/knowledgeConfig.service';

@Module({
  imports: [NestConfigModule, SettingModule],
  providers: [
    { provide: IKnowledgeConfigService, useClass: KnowledgeConfigService },
  ],
  exports: [IKnowledgeConfigService],
})
export class ConfigModule {}
