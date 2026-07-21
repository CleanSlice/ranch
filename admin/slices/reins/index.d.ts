import type { KnowledgeService } from './domain/knowledge.service';

declare module '#app' {
  interface NuxtApp {
    $knowledgeService: KnowledgeService;
  }
}

export {};
