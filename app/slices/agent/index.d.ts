import type { AgentService } from './domain/agent.service';

declare module '#app' {
  interface NuxtApp {
    $agentService: AgentService;
  }
}

export {};
