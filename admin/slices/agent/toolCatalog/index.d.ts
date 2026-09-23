import type { ToolCatalogService } from './domain/toolCatalog.service';

declare module '#app' {
  interface NuxtApp {
    $toolCatalogService: ToolCatalogService;
  }
}

export {};
