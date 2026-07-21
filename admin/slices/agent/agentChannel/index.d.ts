import type { AgentChannelService } from './domain/agentChannel.service';

declare module '#app' {
  interface NuxtApp {
    $agentChannelService: AgentChannelService;
  }
}

export {};
