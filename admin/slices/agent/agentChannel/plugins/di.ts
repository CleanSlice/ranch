import { AgentChannelGateway } from '../data/agentChannel.gateway';
import { AgentChannelService } from '../domain/agentChannel.service';

/**
 * Composition root for the agentChannel slice. Provides `$agentChannelService`.
 */
export default defineNuxtPlugin({
  name: 'agent-channel-di',
  setup() {
    const service = new AgentChannelService(new AgentChannelGateway());
    return {
      provide: {
        agentChannelService: service,
      },
    };
  },
});
