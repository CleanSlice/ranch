import { SecretsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type SecretProviderTypes = 'aws' | 'file';

export interface ISecretEntry {
  name: string;
  value: string;
  updatedAt: string | null;
}

export interface ISecretListData {
  provider: SecretProviderTypes;
  secrets: ISecretEntry[];
}

export const useAgentSecretStore = defineStore('agentSecret', () => {
  const data = ref<ISecretListData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchForAgent(agentId: string): Promise<ISecretListData | null> {
    loading.value = true;
    error.value = null;
    try {
      const res = await SecretsService.secretControllerList({
        path: { agentId },
      });
      const env = res.data as ApiEnvelope<ISecretListData> | undefined;
      data.value = env?.data ?? null;
      return data.value;
    } catch (err) {
      error.value = (err as Error).message;
      data.value = null;
      return null;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    data.value = null;
    error.value = null;
  }

  return { data, loading, error, fetchForAgent, clear };
});
