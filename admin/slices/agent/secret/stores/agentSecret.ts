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

  // set/delete return the full refreshed list — apply it so the UI updates in
  // one round-trip. Throws with the API's message on failure so the caller can
  // surface it (e.g. "AWS credentials are not configured").
  function applyResult(res: {
    data?: unknown;
    error?: unknown;
  }): ISecretListData {
    const env = res.data as ApiEnvelope<ISecretListData> | undefined;
    if (env?.data) {
      data.value = env.data;
      return env.data;
    }
    const err = res.error as { message?: string } | undefined;
    throw new Error(err?.message || 'Secret operation failed');
  }

  async function setSecret(
    agentId: string,
    key: string,
    value: string,
  ): Promise<ISecretListData> {
    const res = await SecretsService.secretControllerSet({
      path: { agentId },
      body: { key, value },
    });
    return applyResult(res);
  }

  async function deleteSecret(
    agentId: string,
    key: string,
  ): Promise<ISecretListData> {
    const res = await SecretsService.secretControllerDelete({
      path: { agentId },
      body: { key },
    });
    return applyResult(res);
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
    clear,
  };
});
