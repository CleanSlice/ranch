import { Module } from '@nestjs/common';
import { LogController } from './log.controller';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';

@Module({
  imports: [AgentModule, SettingModule],
  controllers: [LogController],
})
export class LogModule {}
