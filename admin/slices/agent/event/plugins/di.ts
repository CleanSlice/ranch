import { AgentEventGateway } from '../data/agentEvent.gateway';
import { AgentEventService } from '../domain/agentEvent.service';

/**
 * Composition root for the agent event slice. Provides `$agentEventService`.
 */
export default defineNuxtPlugin({
  name: 'agent-event-di',
  setup() {
    const service = new AgentEventService(new AgentEventGateway());
    return {
      provide: {
        agentEventService: service,
      },
    };
  },
});
