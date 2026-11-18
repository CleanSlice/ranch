import type { AgentAccessService } from './domain/agentAccess.service';

declare module '#app' {
  interface NuxtApp {
    $agentAccessService: AgentAccessService;
  }
}

export {};
