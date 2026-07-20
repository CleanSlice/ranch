import type { AuthService } from './domain/auth.service';

declare module '#app' {
  interface NuxtApp {
    $authService: AuthService;
  }
}

export {};
