import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { SettingModule } from '#/setting/setting.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { AgentLimitService, IAgentLimitGateway } from './domain';
import { AgentLimitGateway } from './data/agentLimit.gateway';
import { AgentLimitController } from './agentLimit.controller';

// Request limits per agent (CLEAN-224).
//
// AgentModule is a forwardRef for the same reason ShareLinkModule needs one:
// BridleModule imports this module (the hub asks the limiter before it
// forwards a request) and AgentModule imports BridleModule, so
// AgentModule → BridleModule → AgentLimitModule → AgentModule.
//
// The limiter never imports the hub. The hub hands itself over
// (`AgentLimitService.attachHub`) so that the cycle above is the only one.
@Module({
  imports: [AuthModule, SettingModule, forwardRef(() => AgentModule)],
  controllers: [AgentLimitController],
  providers: [
    AgentLimitService,
    { provide: IAgentLimitGateway, useClass: AgentLimitGateway },
  ],
  exports: [AgentLimitService],
})
export class AgentLimitModule {}
