import type { SkillService } from './domain/skill.service';

declare module '#app' {
  interface NuxtApp {
    $skillService: SkillService;
  }
}

export {};
