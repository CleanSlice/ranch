import { ref } from 'vue';
import { defineStore } from 'pinia';
import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AssistantAccessService,
  AssistantRole,
  IAssistantAccountData,
  IAssistantCatalog,
  IAssistantException,
  IAssistantRoleData,
  IMyAssistantAccess,
  ISetAssistantInput,
} from '#assistantAccess/domain';

const getService = createServiceGetter<AssistantAccessService>(
  '$assistantAccessService',
);

/**
 * What a change shows before the API has answered. A custom pick is its own
 * count; a level's count waits for the answer.
 */
function optimistic<T extends { enabled: boolean; level: string; offered: number }>(
  current: T,
  input: ISetAssistantInput,
): T {
  return {
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.level === 'custom' && input.on
      ? { offered: input.on.length }
      : {}),
  };
}

/**
 * Who has the assistant and what it offers them, for the two cards that set
 * it (CLEAN-240). One home for each thing (docs/state.md): the two role
 * settings, the accounts that differ from their role, one account's setting
 * by user id, and the catalogue of abilities, which is fetched once.
 *
 * A change shows at once and is put back if the API refuses it.
 */
export function assistantAccessStoreSetup(service: () => AssistantAccessService) {
  const assistant = ref<{ id: string; name: string } | null>(null);
  const roles = ref<Record<AssistantRole, IAssistantRoleData> | null>(null);
  const exceptions = ref<IAssistantException[]>([]);
  const accounts = ref<Record<string, IAssistantAccountData>>({});
  const catalog = ref<IAssistantCatalog | null>(null);
  const notice = ref<{ usersManagingAgents: number } | null>(null);
  // What the assistant offers the person signed in, for their own badge.
  const mine = ref<IMyAssistantAccess | null>(null);

  let catalogInFlight: Promise<IAssistantCatalog | null> | null = null;
  // Bumped when another account signs in: an answer that started for the
  // previous one must not land in this one's store.
  let accountGeneration = 0;

  function accountOf(userId: string): IAssistantAccountData | undefined {
    return accounts.value[userId];
  }

  function upsertAccount(account: IAssistantAccountData): IAssistantAccountData {
    accounts.value = { ...accounts.value, [account.userId]: account };
    return account;
  }

  function resetForAccount() {
    accountGeneration += 1;
    assistant.value = null;
    roles.value = null;
    exceptions.value = [];
    accounts.value = {};
    catalog.value = null;
    catalogInFlight = null;
    notice.value = null;
    mine.value = null;
  }

  async function fetchOverview() {
    const generation = accountGeneration;
    const overview = await service().overview();
    if (generation !== accountGeneration) return;
    assistant.value = overview.assistant;
    roles.value = overview.roles;
    exceptions.value = overview.exceptions;
    notice.value = overview.notice;
  }

  async function fetchMine() {
    const generation = accountGeneration;
    const loaded = await service().mine();
    if (generation !== accountGeneration) return undefined;
    mine.value = loaded;
    return loaded;
  }

  function fetchCatalog(): Promise<IAssistantCatalog | null> {
    if (catalog.value) return Promise.resolve(catalog.value);
    if (!catalogInFlight) {
      const generation = accountGeneration;
      catalogInFlight = service()
        .catalog()
        .then((loaded) => {
          if (generation !== accountGeneration) return null;
          catalog.value = loaded;
          return loaded;
        })
        .finally(() => {
          if (generation === accountGeneration) catalogInFlight = null;
        });
    }
    return catalogInFlight;
  }

  async function saveRole(role: AssistantRole, input: ISetAssistantInput) {
    const before = roles.value?.[role];
    if (!roles.value || !before) return undefined;
    const generation = accountGeneration;
    roles.value = { ...roles.value, [role]: optimistic(before, input) };
    try {
      const saved = await service().setRole(role, {
        ...input,
        version: before.version,
      });
      if (generation !== accountGeneration || !roles.value) return undefined;
      // The route answers the setting; how many accounts follow it has not
      // changed by setting it.
      const next = { ...saved, accounts: before.accounts };
      roles.value = { ...roles.value, [role]: next };
      // Saving the Users' setting, to anything, is the decision the notice
      // asked for.
      if (role === 'User') notice.value = null;
      return next;
    } catch (err) {
      if (generation === accountGeneration && roles.value) {
        roles.value = { ...roles.value, [role]: before };
      }
      throw err;
    }
  }

  async function fetchAccount(userId: string) {
    const generation = accountGeneration;
    const account = await service().account(userId);
    if (generation !== accountGeneration) return undefined;
    return upsertAccount(account);
  }

  async function saveAccount(userId: string, input: ISetAssistantInput) {
    const before = accountOf(userId);
    const generation = accountGeneration;
    if (before) upsertAccount(optimistic(before, input));
    try {
      const saved = await service().setAccount(userId, {
        ...input,
        // Only an account with its own setting has a version to be stale on.
        ...(before?.source === 'account' ? { version: before.version } : {}),
      });
      if (generation !== accountGeneration) return undefined;
      return upsertAccount(saved);
    } catch (err) {
      if (generation === accountGeneration && before) upsertAccount(before);
      throw err;
    }
  }

  /** Back to the role's setting; the list of exceptions changes with it. */
  async function resetAccount(userId: string) {
    const generation = accountGeneration;
    const account = await service().resetAccount(userId);
    if (generation !== accountGeneration) return undefined;
    upsertAccount(account);
    if (roles.value) await fetchOverview();
    return account;
  }

  return {
    assistant,
    roles,
    exceptions,
    accounts,
    catalog,
    notice,
    mine,
    accountOf,
    resetForAccount,
    fetchOverview,
    fetchCatalog,
    fetchMine,
    saveRole,
    fetchAccount,
    saveAccount,
    resetAccount,
  };
}

export const useAssistantAccessStore = defineStore('assistantAccess', () =>
  assistantAccessStoreSetup(getService),
);
