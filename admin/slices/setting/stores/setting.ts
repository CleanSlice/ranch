import { SettingsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type SettingValueTypes = 'string' | 'json';

export interface ISettingData {
  id: string;
  group: string;
  name: string;
  valueType: SettingValueTypes;
  value: unknown;
  updatedAt: string;
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<ISettingData[]>([]);

  async function fetchAll() {
    const res = await SettingsService.settingControllerFindAll();
    const env = res.data as ApiEnvelope<ISettingData[]> | undefined;
    settings.value = env?.data ?? [];
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
    const res = await SettingsService.settingControllerUpsert({
      path: { group, name },
      body: { valueType, value },
    });
    const env = res.data as ApiEnvelope<ISettingData>;
    const updated = env.data;
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
    await SettingsService.settingControllerRemove({ path: { group, name } });
    settings.value = settings.value.filter(
      (s) => !(s.group === group && s.name === name),
    );
  }

  return { settings, fetchAll, get, getValue, upsert, remove };
});
