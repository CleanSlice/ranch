import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IAssistantSettingDrift,
  IRancherStatus,
  RancherService,
} from '#rancher/domain';

// Re-export the domain type so consumers importing it from
// `#rancher/stores/rancher` keep working.
export type { IRancherStatus } from '#rancher/domain';

const getService = createServiceGetter<RancherService>('$rancherService');

export const useRancherStore = defineStore('rancher', () => {
  const status = ref<IRancherStatus | null>(null);

  async function fetchStatus() {
    status.value = await getService().status();
    return status.value;
  }

  async function ensureTemplate() {
    const template = await getService().ensureTemplate();
    if (status.value) status.value = { ...status.value, template };
    return template;
  }

  // The settings kept back from the assistant, for the Owner (CLEAN-271):
  // a setting somebody else changed, which the assistant is not deployed
  // from until the Owner applies it. Keys and names, never a value.
  const settingsDrift = ref<IAssistantSettingDrift[]>([]);

  async function fetchSettingsDrift() {
    settingsDrift.value = await getService().settingsDrift();
    return settingsDrift.value;
  }

  /**
   * Applies the list as it is on screen. The API refuses when the settings
   * changed since it was read: the list is then read again, so that the
   * Owner confirms what is there now and not what was.
   */
  async function applySettings() {
    try {
      const applied = await getService().applySettings(settingsDrift.value);
      settingsDrift.value = [];
      return applied;
    } catch (err) {
      await fetchSettingsDrift().catch(() => undefined);
      throw err;
    }
  }

  return {
    status,
    fetchStatus,
    ensureTemplate,
    settingsDrift,
    fetchSettingsDrift,
    applySettings,
  };
});
