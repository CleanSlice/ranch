import { BrowserService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

/** Mirror of the API enum so the store can render badges without importing
 *  from the generated SDK (which sometimes lags behind on enum exports). */
export enum BrowserSessionStatusTypes {
  Idle = 'idle',
  Active = 'active',
  NeedsLogin = 'needs_login',
  Expired = 'expired',
  Stuck = 'stuck',
}

export interface IBrowserSessionData {
  id: string;
  userId: string;
  accountKey: string;
  status: BrowserSessionStatusTypes;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IBrowserSessionConnectionData {
  session: IBrowserSessionData;
  /** Internal CDP URL — never display in UI, never copy to clipboard. */
  cdpUrl: string;
  vncUrl: string | null;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useBrowserStore = defineStore('browser', () => {
  const items = ref<IBrowserSessionData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // hey-api/openapi-ts uses each route's `operationId` as the method name.
  // Keep these in sync with the @ApiOperation operationId fields in
  // browser.controller.ts.
  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await BrowserService.listBrowserSessions();
      items.value = unwrap<IBrowserSessionData[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function open(
    accountKey: string,
  ): Promise<IBrowserSessionConnectionData | null> {
    const res = await BrowserService.openBrowserSession({
      body: { accountKey },
    });
    const conn = unwrap<IBrowserSessionConnectionData>(res.data);
    if (conn) {
      const existing = items.value.findIndex((x) => x.id === conn.session.id);
      if (existing >= 0) items.value[existing] = conn.session;
      else items.value.unshift(conn.session);
    }
    return conn;
  }

  async function reset(id: string): Promise<IBrowserSessionConnectionData | null> {
    const res = await BrowserService.resetBrowserSession({ path: { id } });
    const conn = unwrap<IBrowserSessionConnectionData>(res.data);
    if (conn) {
      const existing = items.value.findIndex((x) => x.id === conn.session.id);
      if (existing >= 0) items.value[existing] = conn.session;
    }
    return conn;
  }

  async function remove(id: string) {
    await BrowserService.deleteBrowserSession({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  async function mintVncUrl(id: string): Promise<string | null> {
    const res = await BrowserService.mintBrowserSessionVncUrl({ path: { id } });
    const data = unwrap<{ vncUrl: string | null }>(res.data);
    return data?.vncUrl ?? null;
  }

  async function refreshOne(id: string): Promise<IBrowserSessionData | null> {
    const res = await BrowserService.getBrowserSession({ path: { id } });
    const session = unwrap<IBrowserSessionData>(res.data);
    if (session) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value[idx] = session;
    }
    return session;
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    open,
    reset,
    remove,
    mintVncUrl,
    refreshOne,
  };
});
