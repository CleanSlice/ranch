import { AgentGateway } from '../data/agent.gateway';
import { AgentStatusGateway } from '../data/agentStatus.gateway';
import { AgentService } from '../domain/agent.service';
import { AgentStatusService } from '../domain/agentStatus.service';

/**
 * Composition root for the agent slice. Builds the service graphs once and
 * provides them: `$agentService` (CRUD + lifecycle) and `$agentStatusService`
 * (the live SSE status stream).
 */
export default defineNuxtPlugin({
  name: 'agent-di',
  setup() {
    const runtime = useRuntimeConfig();

    const agentService = new AgentService(new AgentGateway());
    const agentStatusService = new AgentStatusService(
      new AgentStatusGateway(() => runtime.public.apiUrl as string),
    );

    return {
      provide: {
        agentService,
        agentStatusService,
      },
    };
  },
});
