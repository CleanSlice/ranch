import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ISessionData, SessionService } from '#sessions/domain';

// Re-export the domain types so consumers importing them from
// `#sessions/stores/session` (session List/Detail/Provider) keep working.
export type { ISessionData, SessionStatusTypes } from '#sessions/domain';

const getService = createServiceGetter<SessionService>('$sessionService');

/**
 * A "session" is a set of browser cookies the user shipped from their own
 * Chrome via the Ranch Cookies extension — the extension's import-state call
 * creates the row on the fly, so the admin only ever lists and removes them.
 */
export const useSessionStore = defineStore('session', () => {
  const items = ref<ISessionData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await getService().listBrowser();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function disconnect(id: string): Promise<void> {
    await getService().disconnect(id);
    items.value = items.value.filter((x) => x.id !== id);
  }

  return { items, loading, error, fetchAll, disconnect };
});
