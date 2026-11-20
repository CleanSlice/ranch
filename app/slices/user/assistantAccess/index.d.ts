import type { AssistantAccessService } from './domain/assistantAccess.service';

declare module '#app' {
  interface NuxtApp {
    $assistantAccessService: AssistantAccessService;
  }
}

export {};
