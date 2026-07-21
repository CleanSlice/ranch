import type { UserService } from './domain/user.service';

declare module '#app' {
  interface NuxtApp {
    $userService: UserService;
  }
}

export {};
