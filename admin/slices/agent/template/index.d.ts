import type { TemplateService } from './domain/template.service';

declare module '#app' {
  interface NuxtApp {
    $templateService: TemplateService;
  }
}

export {};
