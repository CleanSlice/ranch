import type { ProfileStatsService } from './domain/stats.service';

declare module '#app' {
  interface NuxtApp {
    $profileStatsService: ProfileStatsService;
  }
}

export {};
