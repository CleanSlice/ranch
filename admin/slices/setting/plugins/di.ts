import { SettingGateway } from '../data/setting.gateway';
import { SettingService } from '../domain/setting.service';

/**
 * Composition root for the setting slice. Provides `$settingService`.
 */
export default defineNuxtPlugin({
  name: 'setting-di',
  setup() {
    const service = new SettingService(new SettingGateway());
    return {
      provide: {
        settingService: service,
      },
    };
  },
});
