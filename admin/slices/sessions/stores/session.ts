import { client } from '#api/data/repositories/api/client.gen';

type ApiEnvelope<T> = { success: boolean; data: T };

export type SessionStatusTypes =
  | 'pending'
  | 'connected'
  | 'needs_login'
  | 'revoked';

export interface ISessionData {
  id: string;
  userId: string;
  service: string;
  accountKey: string;
  mechanism: 'browser' | 'secret';
  label: string | null;
  status: SessionStatusTypes;
  createdAt: string;
  updatedAt: string;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

/**
 * A "session" is a set of browser cookies the user shipped from their own
 * Chrome via the Ranch Cookies extension — the extension's import-state
 * call creates the row on the fly, so the admin only ever lists and
 * removes them. Talks to ranch-api over the same axios client the SDK
 * uses (inherits the JWT interceptors).
 */
export const useSessionStore = defineStore('session', () => {
  const items = ref<ISessionData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await client.get<ApiEnvelope<ISessionData[]>>({
        url: '/integrations/accounts',
      });
      const all = unwrap<ISessionData[]>(res.data) ?? [];
      items.value = all.filter((x) => x.mechanism === 'browser');
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function disconnect(id: string): Promise<void> {
    await client.delete({
      url: `/integrations/accounts/${encodeURIComponent(id)}`,
    });
    items.value = items.value.filter((x) => x.id !== id);
  }

  return { items, loading, error, fetchAll, disconnect };
});
