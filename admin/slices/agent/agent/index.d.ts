import type { AgentService } from './domain/agent.service';
import type { AgentStatusService } from './domain/agentStatus.service';

declare module '#app' {
  interface NuxtApp {
    $agentService: AgentService;
    $agentStatusService: AgentStatusService;
  }
}

export {};
