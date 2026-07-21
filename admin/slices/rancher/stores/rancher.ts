import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { IRancherStatus, RancherService } from '#rancher/domain';

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

  return { status, fetchStatus, ensureTemplate };
});
