import type { AgentSecretService } from './domain/agentSecret.service';

declare module '#app' {
  interface NuxtApp {
    $agentSecretService: AgentSecretService;
  }
}

export {};
