import type { TemplateFileService } from './domain/templateFile.service';

declare module '#app' {
  interface NuxtApp {
    $templateFileService: TemplateFileService;
  }
}

export {};
