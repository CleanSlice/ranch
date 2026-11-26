import { AgentGateway } from '../data/agent.gateway';
import { AgentStatusGateway } from '../data/agentStatus.gateway';
import { AgentService } from '../domain/agent.service';

/**
 * Composition root for the agent slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$agentService`.
 */
export default defineNuxtPlugin({
  name: 'agent-di',
  setup() {
    const service = new AgentService(new AgentGateway());
    const runtime = useRuntimeConfig();
    // The live status stream (CLEAN-247). A gateway with no service above it:
    // there is no rule to hold, it only opens and closes one EventSource.
    const agentStatusGateway = new AgentStatusGateway(
      () => (runtime.public.apiUrl as string | undefined) ?? '',
    );
    return {
      provide: {
        agentService: service,
        agentStatusGateway,
      },
    };
  },
});
