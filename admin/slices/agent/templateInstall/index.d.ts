import type { TemplateInstallService } from './domain/templateInstall.service';

declare module '#app' {
  interface NuxtApp {
    $templateInstallService: TemplateInstallService;
  }
}

export {};
