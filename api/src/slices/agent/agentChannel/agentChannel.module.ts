import { Module, forwardRef } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentChannelController } from './agentChannel.controller';
import { IAgentChannelGateway } from './domain/agentChannel.gateway';
import { AgentChannelGateway } from './data/agentChannel.gateway';
import { AgentChannelMapper } from './data/agentChannel.mapper';

// FileModule is forwardRef'd because the file slice already participates
// in the AgentModule ↔ FileModule cycle; importing it directly here is
// safe (we only consume IFileGateway, no back-edge), but forwardRef
// matches the rest of the file slice's consumers and survives any
// future restructuring.
@Module({
  imports: [forwardRef(() => FileModule), AuthModule],
  controllers: [AgentChannelController],
  providers: [
    AgentChannelMapper,
    {
      provide: IAgentChannelGateway,
      useClass: AgentChannelGateway,
    },
  ],
  exports: [IAgentChannelGateway],
})
export class AgentChannelModule {}
