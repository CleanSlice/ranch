import { AgentGateway } from '../data/agent.gateway';
import { AgentLimitGateway } from '../data/agentLimit.gateway';
import { AgentStatusGateway } from '../data/agentStatus.gateway';
import { AgentService } from '../domain/agent.service';
import { AgentLimitService } from '../domain/agentLimit.service';
import { AgentStatusService } from '../domain/agentStatus.service';

/**
 * Composition root for the agent slice. Builds the service graphs once and
 * provides them: `$agentService` (CRUD + lifecycle), `$agentStatusService`
 * (the live SSE status stream) and `$agentLimitService` (request limits and
 * live load, CLEAN-224).
 */
export default defineNuxtPlugin({
  name: 'agent-di',
  setup() {
    const runtime = useRuntimeConfig();

    const agentService = new AgentService(new AgentGateway());
    const agentStatusService = new AgentStatusService(
      new AgentStatusGateway(() => runtime.public.apiUrl as string),
    );
    const agentLimitService = new AgentLimitService(new AgentLimitGateway());

    return {
      provide: {
        agentService,
        agentLimitService,
        agentStatusService,
      },
    };
  },
});
