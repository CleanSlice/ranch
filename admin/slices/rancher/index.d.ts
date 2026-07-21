import type { RancherService } from './domain/rancher.service';

declare module '#app' {
  interface NuxtApp {
    $rancherService: RancherService;
  }
}

export {};
