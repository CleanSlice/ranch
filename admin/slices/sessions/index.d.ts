import type { SessionService } from './domain/session.service';

declare module '#app' {
  interface NuxtApp {
    $sessionService: SessionService;
  }
}

export {};
