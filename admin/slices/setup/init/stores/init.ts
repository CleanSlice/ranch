import { SetupService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

interface IOwnerResult {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
  };
}

export const useInitStore = defineStore('init', () => {
  const requiresInit = ref(false);
  const checked = ref(false);

  async function ensureChecked(force = false) {
    if (checked.value && !force) return requiresInit.value;
    const res = await SetupService.initControllerStatus();
    const env = res.data as ApiEnvelope<{ requiresInit: boolean }>;
    requiresInit.value = !!env?.data?.requiresInit;
    checked.value = true;
    return requiresInit.value;
  }

  async function createOwner(name: string, email: string, password: string) {
    const res = await SetupService.initControllerInit({
      body: { name, email, password },
    });
    const env = res.data as ApiEnvelope<IOwnerResult>;
    requiresInit.value = false;
    checked.value = true;
    return env.data;
  }

  return { requiresInit, checked, ensureChecked, createOwner };
});
