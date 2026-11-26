import type { AgentService } from './domain/agent.service';
import type { AgentStatusGateway } from './data/agentStatus.gateway';

declare module '#app' {
  interface NuxtApp {
    $agentService: AgentService;
    $agentStatusGateway: AgentStatusGateway;
  }
}

export {};
