import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentSecretService, ISecretListData } from '#agentSecret/domain';

// Re-export the domain types so `agentSecret/Provider.vue` (and any future
// consumer importing from `#agentSecret/stores/agentSecret`) keeps working.
export type {
  ISecretEntry,
  ISecretListData,
  SecretProviderTypes,
} from '#agentSecret/domain';

const getService = createServiceGetter<AgentSecretService>(
  '$agentSecretService',
);

export const useAgentSecretStore = defineStore('agentSecret', () => {
  const data = ref<ISecretListData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchForAgent(agentId: string): Promise<ISecretListData | null> {
    loading.value = true;
    error.value = null;
    try {
      data.value = await getService().list(agentId);
      return data.value;
    } catch (err) {
      error.value = (err as Error).message;
      data.value = null;
      return null;
    } finally {
      loading.value = false;
    }
  }

  // set/delete/replace return the full refreshed list — apply it so the UI
  // updates in one round-trip. The service throws the API's message on failure
  // so the caller can surface it (e.g. "AWS credentials are not configured").
  async function setSecret(
    agentId: string,
    key: string,
    value: string,
  ): Promise<ISecretListData> {
    const updated = await getService().set(agentId, key, value);
    data.value = updated;
    return updated;
  }

  async function deleteSecret(
    agentId: string,
    key: string,
  ): Promise<ISecretListData> {
    const updated = await getService().remove(agentId, key);
    data.value = updated;
    return updated;
  }

  // Atomic full-store replace — used by the JSON-view editor. Pass {} to clear.
  async function replaceAllSecrets(
    agentId: string,
    store: Record<string, string>,
  ): Promise<ISecretListData> {
    const updated = await getService().replaceAll(agentId, store);
    data.value = updated;
    return updated;
  }

  function clear() {
    data.value = null;
    error.value = null;
  }

  return {
    data,
    loading,
    error,
    fetchForAgent,
    setSecret,
    deleteSecret,
    replaceAllSecrets,
    clear,
  };
});
