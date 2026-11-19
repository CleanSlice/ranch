import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentAccessService,
  IAgentAccessData,
  ISetAgentAccessInput,
} from '#agentAccess/domain';
import type { AgentAccessKindTypes } from '#user/domain/user.types';

const getService = createServiceGetter<AgentAccessService>('$agentAccessService');

/**
 * One account's agent access, once, keyed by the account's id (docs/state.md,
 * research R11). The editor renders `byId(userId)`; a read upserts, a save
 * patches first and rolls back when the API refuses.
 */
export const useAgentAccessStore = defineStore('agentAccess', () => {
  const byUser = ref<Record<string, IAgentAccessData>>({});
  // Bumped by `resetForAccount`: an answer that was on its way when the
  // account changed is about what the previous account could see.
  let accountGeneration = 0;

  // Plain lookup, reactive when read inside a computed.
  function byId(userId: string): IAgentAccessData | undefined {
    return byUser.value[userId];
  }

  // What the lists come to is also the mark on the user list. It is one
  // fact, so it is written into the user's own record (the user store), not
  // kept here for the list to prefer.
  function markUser(access: IAgentAccessData) {
    useUserStore().patch(access.userId, {
      agentAccess: {
        kind: access.outcome.kind as AgentAccessKindTypes,
        needsReview: access.needsReview,
      },
    });
  }

  // Full records only: whatever the API returned for one account.
  function upsert(access: IAgentAccessData): IAgentAccessData {
    byUser.value = { ...byUser.value, [access.userId]: access };
    markUser(access);
    return access;
  }

  // Partial change to a known record. Returns a rollback that restores only
  // the fields still holding the patched value: if a read wrote something
  // fresher in between, undoing the guess must not undo the truth. The lists
  // are arrays, which the store hands back wrapped: compared unwrapped.
  function patch(userId: string, partial: Partial<IAgentAccessData>): () => void {
    const previous = byId(userId);
    if (!previous) return () => {};
    byUser.value = { ...byUser.value, [userId]: { ...previous, ...partial } };
    return () => {
      const current = byId(userId);
      if (!current) return;
      const restored: Record<string, unknown> = {};
      for (const key of Object.keys(partial) as (keyof IAgentAccessData)[]) {
        if (toRaw(current[key]) === toRaw(partial[key])) restored[key] = previous[key];
      }
      byUser.value = {
        ...byUser.value,
        [userId]: { ...current, ...(restored as Partial<IAgentAccessData>) },
      };
    };
  }

  // Whoever was signed in is not any more: what they could see of other
  // accounts' access goes with them. The ONE way this store is emptied for
  // an account change (docs/state.md).
  function resetForAccount() {
    accountGeneration += 1;
    byUser.value = {};
  }

  async function fetchById(userId: string) {
    const generation = accountGeneration;
    const access = await getService().get(userId);
    if (generation !== accountGeneration) return undefined;
    return upsert(access);
  }

  // The lists move at once and go back if the API refuses; the answer, which
  // also carries the new outcome and version, replaces the record. A refusal
  // saves nothing and is thrown to the caller as received.
  async function save(userId: string, input: ISetAgentAccessInput) {
    const generation = accountGeneration;
    const rollback = patch(userId, {
      allowed: [...input.allowed],
      denied: [...input.denied],
    });
    try {
      const saved = await getService().set(userId, input);
      if (generation !== accountGeneration) return undefined;
      return upsert(saved);
    } catch (err) {
      rollback();
      throw err;
    }
  }

  return { byUser, byId, upsert, patch, resetForAccount, fetchById, save };
});
