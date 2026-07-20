import { AgentGateway } from '../data/agent.gateway';
import { AgentService } from '../domain/agent.service';

/**
 * Composition root for the agent slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$agentService`.
 */
export default defineNuxtPlugin({
  name: 'agent-di',
  setup() {
    const service = new AgentService(new AgentGateway());
    return {
      provide: {
        agentService: service,
      },
    };
  },
});
