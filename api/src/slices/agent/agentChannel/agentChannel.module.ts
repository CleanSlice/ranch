import { Module, forwardRef } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentChannelController } from './agentChannel.controller';
import { AgentChannelTool } from './agentChannel.tool';
import { IAgentChannelGateway } from './domain/agentChannel.gateway';
import { AgentChannelGateway } from './data/agentChannel.gateway';
import { AgentChannelMapper } from './data/agentChannel.mapper';

// FileModule is forwardRef'd because the file slice already participates
// in the AgentModule ↔ FileModule cycle; importing it directly here is
// safe (we only consume IFileGateway, no back-edge), but forwardRef
// matches the rest of the file slice's consumers and survives any
// future restructuring.
//
// AgentModule (IAgentGateway, for the chat tool's existence check) must be a
// forwardRef: AgentModule → WorkflowModule → AgentChannelModule already
// exists, so a plain import here would close the cycle.
@Module({
  imports: [
    forwardRef(() => FileModule),
    forwardRef(() => AgentModule),
    AuthModule,
  ],
  controllers: [AgentChannelController],
  providers: [
    AgentChannelMapper,
    AgentChannelTool,
    {
      provide: IAgentChannelGateway,
      useClass: AgentChannelGateway,
    },
  ],
  exports: [IAgentChannelGateway],
})
export class AgentChannelModule {}
