import type { McpServerService } from './domain/mcpServer.service';

declare module '#app' {
  interface NuxtApp {
    $mcpServerService: McpServerService;
  }
}

export {};
