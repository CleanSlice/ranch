import { client } from '#api/data/repositories/api/client.gen';

type ApiEnvelope<T> = { success: boolean; data: T };

export type IntegrationMechanismTypes = 'browser' | 'secret';

export type IntegrationStatusTypes =
  | 'pending'
  | 'connected'
  | 'needs_login'
  | 'revoked';

export interface IIntegrationCatalogueItem {
  service: string;
  title: string;
  description: string;
  iconUrl: string;
  mechanism: IntegrationMechanismTypes;
  loginUrl?: string;
  accountKeyHint?: string;
  secretEnvKey?: string;
  secretHelp?: string;
}

export interface IIntegrationAccountData {
  id: string;
  userId: string;
  service: string;
  accountKey: string;
  mechanism: IntegrationMechanismTypes;
  label: string | null;
  status: IntegrationStatusTypes;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ILoginInstructionData {
  accountId: string;
  siteUrl: string;
  helpUrl: string;
  instructions: string;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

/**
 * Store talks to ranch-api over the same axios client the generated SDK
 * uses (so it inherits the JWT/auth interceptors). We hand-roll the calls
 * for now because the SDK regen pipeline has a pre-existing build issue
 * unrelated to integrations — swap these for IntegrationsService.* once
 * `cd admin && bun run build:api` is unblocked.
 */
export const useIntegrationStore = defineStore('integration', () => {
  const catalogue = ref<IIntegrationCatalogueItem[]>([]);
  const items = ref<IIntegrationAccountData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchCatalogue() {
    const res = await client.get<ApiEnvelope<IIntegrationCatalogueItem[]>>({
      url: '/integrations/catalogue',
    });
    catalogue.value = unwrap<IIntegrationCatalogueItem[]>(res.data) ?? [];
    return catalogue.value;
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await client.get<ApiEnvelope<IIntegrationAccountData[]>>({
        url: '/integrations/accounts',
      });
      items.value = unwrap<IIntegrationAccountData[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function connect(input: {
    service: string;
    accountKey: string;
    label?: string;
    aliases?: string[];
  }): Promise<IIntegrationAccountData | null> {
    const res = await client.post<ApiEnvelope<IIntegrationAccountData>>({
      url: '/integrations/accounts',
      body: input,
    });
    const account = unwrap<IIntegrationAccountData>(res.data);
    if (account) upsert(account);
    return account;
  }

  async function openLogin(id: string): Promise<ILoginInstructionData | null> {
    const res = await client.post<ApiEnvelope<ILoginInstructionData>>({
      url: `/integrations/accounts/${encodeURIComponent(id)}/login`,
    });
    return unwrap<ILoginInstructionData>(res.data);
  }

  async function importCookies(
    id: string,
    payload: {
      cookies: unknown[];
      origins?: unknown[];
      userAgent?: string;
    },
  ): Promise<IIntegrationAccountData | null> {
    const res = await client.post<ApiEnvelope<IIntegrationAccountData>>({
      url: `/integrations/accounts/${encodeURIComponent(id)}/import-cookies`,
      body: payload,
    });
    const account = unwrap<IIntegrationAccountData>(res.data);
    if (account) upsert(account);
    return account;
  }

  async function saveSecret(
    id: string,
    value: string,
  ): Promise<IIntegrationAccountData | null> {
    const res = await client.post<ApiEnvelope<IIntegrationAccountData>>({
      url: `/integrations/accounts/${encodeURIComponent(id)}/secret`,
      body: { value },
    });
    const account = unwrap<IIntegrationAccountData>(res.data);
    if (account) upsert(account);
    return account;
  }

  async function refreshOne(
    id: string,
  ): Promise<IIntegrationAccountData | null> {
    const res = await client.get<ApiEnvelope<IIntegrationAccountData>>({
      url: `/integrations/accounts/${encodeURIComponent(id)}`,
    });
    const account = unwrap<IIntegrationAccountData>(res.data);
    if (account) upsert(account);
    return account;
  }

  async function updateAliases(
    id: string,
    aliases: string[],
  ): Promise<IIntegrationAccountData | null> {
    const res = await client.patch<ApiEnvelope<IIntegrationAccountData>>({
      url: `/integrations/accounts/${encodeURIComponent(id)}/aliases`,
      body: { aliases },
    });
    const account = unwrap<IIntegrationAccountData>(res.data);
    if (account) upsert(account);
    return account;
  }

  async function disconnect(id: string): Promise<void> {
    await client.delete({
      url: `/integrations/accounts/${encodeURIComponent(id)}`,
    });
    items.value = items.value.filter((x) => x.id !== id);
  }

  function upsert(account: IIntegrationAccountData) {
    const idx = items.value.findIndex((x) => x.id === account.id);
    if (idx >= 0) items.value[idx] = account;
    else items.value.unshift(account);
  }

  return {
    catalogue,
    items,
    loading,
    error,
    fetchCatalogue,
    fetchAll,
    connect,
    openLogin,
    importCookies,
    saveSecret,
    updateAliases,
    refreshOne,
    disconnect,
  };
});
