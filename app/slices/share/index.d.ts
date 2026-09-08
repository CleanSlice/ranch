import type { ShareService } from './domain/share.service';

declare module '#app' {
  interface NuxtApp {
    $shareService: ShareService;
  }
}

export {};
