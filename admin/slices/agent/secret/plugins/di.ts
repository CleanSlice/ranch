import { AgentSecretGateway } from '../data/agentSecret.gateway';
import { AgentSecretService } from '../domain/agentSecret.service';

/**
 * Composition root for the agentSecret slice. Provides `$agentSecretService`.
 */
export default defineNuxtPlugin({
  name: 'agent-secret-di',
  setup() {
    const service = new AgentSecretService(new AgentSecretGateway());
    return {
      provide: {
        agentSecretService: service,
      },
    };
  },
});
