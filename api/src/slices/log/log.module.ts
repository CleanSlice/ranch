import { Module } from '@nestjs/common';
import { LogController } from './log.controller';
import { LogService } from './domain';
import { LogTool } from './log.tool';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';

@Module({
  imports: [AgentModule, SettingModule],
  controllers: [LogController],
  providers: [LogService, LogTool],
})
export class LogModule {}
