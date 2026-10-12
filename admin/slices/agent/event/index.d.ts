import type { AgentEventService } from './domain/agentEvent.service';

declare module '#app' {
  interface NuxtApp {
    $agentEventService: AgentEventService;
  }
}

export {};
