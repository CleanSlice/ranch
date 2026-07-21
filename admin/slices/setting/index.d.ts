import type { SettingService } from './domain/setting.service';

declare module '#app' {
  interface NuxtApp {
    $settingService: SettingService;
  }
}

export {};
