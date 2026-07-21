import type { BridleService } from './domain/bridle.service';

declare module '#app' {
  interface NuxtApp {
    $bridleService: BridleService;
  }
}

export {};
