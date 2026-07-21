import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ISettingData, SettingService, SettingValueTypes } from '#setting/domain';

// Re-export the domain types so consumers importing them from
// `#setting/stores/setting` keep working.
export type { ISettingData, SettingValueTypes } from '#setting/domain';

const getService = createServiceGetter<SettingService>('$settingService');

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<ISettingData[]>([]);

  async function fetchAll() {
    settings.value = await getService().list();
    return settings.value;
  }

  function get(group: string, name: string): ISettingData | undefined {
    return settings.value.find((s) => s.group === group && s.name === name);
  }

  function getValue<T = unknown>(group: string, name: string, fallback: T): T {
    const s = get(group, name);
    return (s?.value as T) ?? fallback;
  }

  async function upsert(
    group: string,
    name: string,
    value: unknown,
    valueType: SettingValueTypes = 'string',
  ) {
    const updated = await getService().upsert(group, name, value, valueType);
    const existing = settings.value.findIndex(
      (s) => s.group === group && s.name === name,
    );
    if (existing >= 0) {
      settings.value.splice(existing, 1, updated);
    } else {
      settings.value.push(updated);
    }
    return updated;
  }

  async function remove(group: string, name: string) {
    await getService().remove(group, name);
    settings.value = settings.value.filter(
      (s) => !(s.group === group && s.name === name),
    );
  }

  return { settings, fetchAll, get, getValue, upsert, remove };
});
