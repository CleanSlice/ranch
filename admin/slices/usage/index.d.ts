import type { UsageService } from './domain/usage.service';

declare module '#app' {
  interface NuxtApp {
    $usageService: UsageService;
  }
}

export {};
