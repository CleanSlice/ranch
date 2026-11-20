import { describe, expect, test } from 'bun:test';
import type { AssistantAccessService } from '#assistantAccess/domain/assistantAccess.service';
import type {
  IAssistantAccountData,
  IAssistantCatalog,
  IAssistantOverview,
  IAssistantRoleData,
} from '#assistantAccess/domain/assistantAccess.types';
import { assistantAccessStoreSetup } from './assistantAccess';

// The store's setup function is exercised directly, with a hand-made service:
// no Nuxt app, no Pinia instance.

const role = (over: Partial<IAssistantRoleData> = {}): IAssistantRoleData => ({
  enabled: true,
  level: 'full',
  matchesLevel: null,
  source: 'role',
  offered: 8,
  available: 8,
  version: 'v1',
  pick: null,
  accounts: 2,
  ...over,
});

const account = (over: Partial<IAssistantAccountData> = {}): IAssistantAccountData => ({
  ...role(),
  userId: 'u1',
  role: 'Admin',
  roleSetting: role(),
  editable: true,
  ceiling: null,
  ...over,
});

const OVERVIEW: IAssistantOverview = {
  assistant: { id: 'r', name: 'Rancher' },
  roles: { Admin: role(), User: role({ level: 'basic', offered: 2, available: 3 }) },
  exceptions: [],
  notice: { usersManagingAgents: 3 },
};
const CATALOG: IAssistantCatalog = { areas: [], alwaysOn: [] };

function fake(over: Partial<AssistantAccessService> = {}) {
  const calls: string[] = [];
  const service = {
    overview: async () => (calls.push('overview'), structuredClone(OVERVIEW)),
    catalog: async () => (calls.push('catalog'), CATALOG),
    setRole: async (r: string, input: object) => {
      calls.push(`setRole ${r} ${JSON.stringify(input)}`);
      return role({ level: 'standard', offered: 7, version: 'v2' });
    },
    account: async (id: string) => (calls.push(`account ${id}`), account({ userId: id })),
    setAccount: async (id: string, input: object) => {
      calls.push(`setAccount ${id} ${JSON.stringify(input)}`);
      return account({ userId: id, level: 'basic', source: 'account', version: 'a2' });
    },
    resetAccount: async (id: string) => (calls.push(`reset ${id}`), account({ userId: id })),
    mine: async () => ({ enabled: true, level: 'basic', matchesLevel: null, areas: [] }),
    ...over,
  } as unknown as AssistantAccessService;
  return { store: assistantAccessStoreSetup(() => service), calls };
}

/** The message a promise is rejected with, or '' when it is not. */
async function failure(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('the assistant access store', () => {
  test('a fetch fills the roles, the exceptions and who the assistant is', async () => {
    const { store } = fake();
    await store.fetchOverview();
    expect(store.assistant.value).toEqual({ id: 'r', name: 'Rancher' });
    expect(store.roles.value?.User.level).toBe('basic');
    expect(store.exceptions.value).toEqual([]);
  });

  test('the notice about Users is shown until their setting is saved', async () => {
    const { store } = fake();
    await store.fetchOverview();
    expect(store.notice.value).toEqual({ usersManagingAgents: 3 });
    await store.saveRole('Admin', { level: 'standard' });
    expect(store.notice.value).toEqual({ usersManagingAgents: 3 });
    await store.saveRole('User', { level: 'basic' });
    expect(store.notice.value).toBe(null);
  });

  test('what the assistant offers the person signed in', async () => {
    const { store } = fake();
    await store.fetchMine();
    expect(store.mine.value?.level).toBe('basic');
    store.resetForAccount();
    expect(store.mine.value).toBe(null);
  });

  test('the catalogue is fetched once, however many cards ask', async () => {
    const { store, calls } = fake();
    await Promise.all([store.fetchCatalog(), store.fetchCatalog()]);
    await store.fetchCatalog();
    expect(calls.filter((c) => c === 'catalog').length).toBe(1);
    expect(store.catalog.value).toEqual(CATALOG);
  });

  test('a role change shows at once, then takes the saved answer and keeps the count', async () => {
    const { store, calls } = fake();
    await store.fetchOverview();
    const pending = store.saveRole('Admin', { level: 'standard' });
    expect(store.roles.value?.Admin.level).toBe('standard');
    await pending;
    const saved = store.roles.value?.Admin;
    expect([saved?.level, saved?.offered, saved?.version, saved?.accounts]).toEqual(['standard', 7, 'v2', 2]);
    expect(calls).toContain('setRole Admin {"level":"standard","version":"v1"}');
  });

  test('a refused role change is rolled back and the refusal is rethrown', async () => {
    const { store } = fake({
      setRole: async () => {
        throw new Error('stale');
      },
    } as never);
    await store.fetchOverview();
    expect(await failure(store.saveRole('Admin', { enabled: false }))).toBe('stale');
    expect([store.roles.value?.Admin.enabled, store.roles.value?.Admin.level]).toEqual([true, 'full']);
  });

  test('an account is kept by user id, and a save upserts it', async () => {
    const { store, calls } = fake();
    await store.fetchAccount('u1');
    expect(store.accountOf('u1')?.source).toBe('role');
    await store.saveAccount('u1', { level: 'basic' });
    const own = store.accountOf('u1');
    expect([own?.level, own?.source, own?.version]).toEqual(['basic', 'account', 'a2']);
    // An account that follows its role has no version of its own to send.
    expect(calls).toContain('setAccount u1 {"level":"basic"}');
  });

  test('a refused account change is rolled back', async () => {
    const { store } = fake({
      setAccount: async () => {
        throw new Error('above your own');
      },
    } as never);
    await store.fetchAccount('u1');
    expect(await failure(store.saveAccount('u1', { level: 'full', enabled: false }))).toBe('above your own');
    const back = store.accountOf('u1');
    expect([back?.enabled, back?.level, back?.source]).toEqual([true, 'full', 'role']);
  });

  test('reset returns the account to its role and reloads the overview that lists it', async () => {
    const { store, calls } = fake();
    await store.fetchOverview();
    await store.fetchAccount('u1');
    await store.resetAccount('u1');
    expect(store.accountOf('u1')?.source).toBe('role');
    expect(calls.filter((c) => c === 'overview').length).toBe(2);
  });

  test('another account signing in empties it; an answer for the old one is dropped', async () => {
    let release: (v: IAssistantOverview) => void = () => undefined;
    const { store } = fake({
      overview: () => new Promise<IAssistantOverview>((resolve) => (release = resolve)),
    } as never);
    const pending = store.fetchOverview();
    store.resetForAccount();
    release(structuredClone(OVERVIEW));
    await pending;
    expect(store.roles.value).toBe(null);
    expect(store.catalog.value).toBe(null);
  });
});
