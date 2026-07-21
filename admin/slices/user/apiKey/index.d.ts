import type { ApiKeyService } from './domain/apiKey.service';

declare module '#app' {
  interface NuxtApp {
    $apiKeyService: ApiKeyService;
  }
}

export {};
