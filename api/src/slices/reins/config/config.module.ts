import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { SettingModule } from '#/setting/setting.module';
import { IKnowledgeConfigGateway } from './domain/knowledgeConfig.gateway';
import { KnowledgeConfigGateway } from './data/knowledgeConfig.gateway';

@Module({
  imports: [NestConfigModule, SettingModule],
  providers: [
    { provide: IKnowledgeConfigGateway, useClass: KnowledgeConfigGateway },
  ],
  exports: [IKnowledgeConfigGateway],
})
export class ConfigModule {}
