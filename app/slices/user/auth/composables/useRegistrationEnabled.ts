import { SettingsService } from '#api/data';

interface IPublicAuthSettings {
  registrationEnabled: boolean;
}

interface ISettingItem {
  group: string;
  name: string;
  value: unknown;
}

/**
 * Whether self-service /register is currently allowed. The setting is stored
 * server-side under `auth.registration_enabled` and exposed via the public
 * settings list endpoint. Returned as a ref so pages can react to it.
 */
export function useRegistrationEnabled() {
  const enabled = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refresh(): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await SettingsService.settingControllerFindByGroup({
        path: { group: 'auth' },
      });
      const env = res.data as { success: boolean; data: ISettingItem[] } | undefined;
      const item = env?.data?.find((s) => s.name === 'registration_enabled');
      enabled.value = item?.value === true || item?.value === 'true';
    } catch (err) {
      error.value = (err as Error).message ?? 'Failed to load auth settings';
    } finally {
      loading.value = false;
    }
    return enabled.value;
  }

  return { enabled, loading, error, refresh };
}

export type { IPublicAuthSettings };
