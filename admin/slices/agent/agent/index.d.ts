import type { AgentService } from './domain/agent.service';
import type { AgentLimitService } from './domain/agentLimit.service';
import type { AgentStatusService } from './domain/agentStatus.service';

declare module '#app' {
  interface NuxtApp {
    $agentService: AgentService;
    $agentLimitService: AgentLimitService;
    $agentStatusService: AgentStatusService;
  }
}

export {};
