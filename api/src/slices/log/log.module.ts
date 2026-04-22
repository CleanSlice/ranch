import { Module } from '@nestjs/common';
import { LogController } from './log.controller';
import { AgentModule } from '#/agent/agent/agent.module';

@Module({
  imports: [AgentModule],
  controllers: [LogController],
})
export class LogModule {}
