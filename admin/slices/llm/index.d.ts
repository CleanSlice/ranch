import type { LlmService } from './domain/llm.service';

declare module '#app' {
  interface NuxtApp {
    $llmService: LlmService;
  }
}

export {};
