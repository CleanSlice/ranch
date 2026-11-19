import { AgentAccessGateway } from '../data/agentAccess.gateway';
import { AgentAccessService } from '../domain/agentAccess.service';

/**
 * Composition root for the agentAccess slice. Provides `$agentAccessService`.
 */
export default defineNuxtPlugin({
  name: 'agent-access-di',
  setup() {
    const service = new AgentAccessService(new AgentAccessGateway());
    return {
      provide: {
        agentAccessService: service,
      },
    };
  },
});
