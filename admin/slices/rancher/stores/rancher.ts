import { RancherService } from '#api/data';
import type { IAgentData } from '#agent/stores/agent';
import type { ITemplateData } from '#template/stores/template';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface IRancherStatus {
  hasLlm: boolean;
  template: ITemplateData | null;
  admin: IAgentData | null;
}

export const useRancherStore = defineStore('rancher', () => {
  const status = ref<IRancherStatus | null>(null);

  async function fetchStatus() {
    const res = await RancherService.rancherControllerStatus();
    const env = res.data as ApiEnvelope<IRancherStatus> | undefined;
    status.value = env?.data ?? null;
    return status.value;
  }

  async function ensureTemplate() {
    const res = await RancherService.rancherControllerEnsureTemplate();
    if (res.error) {
      const err = res.error as { message?: string };
      throw new Error(err.message ?? 'Failed to create Rancher template');
    }
    const env = res.data as ApiEnvelope<ITemplateData>;
    if (status.value) status.value = { ...status.value, template: env.data };
    return env.data;
  }

  return { status, fetchStatus, ensureTemplate };
});
