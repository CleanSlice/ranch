import type { AgentFileService } from './domain/agentFile.service';

declare module '#app' {
  interface NuxtApp {
    $agentFileService: AgentFileService;
  }
}

export {};
