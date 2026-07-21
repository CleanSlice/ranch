import type { ChatService } from './domain/chat.service';

declare module '#app' {
  interface NuxtApp {
    $chatService: ChatService;
  }
}

export {};
