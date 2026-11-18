import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateUserData,
  IUpdateUserData,
  IUserData,
  UserRoleTypes,
  UserService,
} from '#user/domain';

const getService = createServiceGetter<UserService>('$userService');

export const useUserStore = defineStore('user', () => {
  const users = ref<IUserData[]>([]);
  // Bumped by `resetForAccount`: a list that was on its way when the account
  // changed was read for the previous account and is dropped.
  let accountGeneration = 0;

  // Whoever was signed in is not any more (CLEAN-231): the accounts they
  // could list go with them. The ONE way this store is emptied for an
  // account change (docs/state.md).
  function resetForAccount() {
    accountGeneration += 1;
    users.value = [];
  }

  // Plain lookup, reactive when read inside a computed. The one source every
  // user screen renders from (docs/state.md): the list row, the detail page
  // and the edit page are the same record and cannot disagree.
  function byId(id: string): IUserData | undefined {
    return users.value.find((u) => u.id === id);
  }

  // Full records only (anything the API returned for one account): replaces
  // the row in place so the list keeps its order, appends when the id is new.
  // The access mark travels on the /users routes only, so a record that does
  // not say keeps the mark the store already holds.
  function upsert(incoming: IUserData): IUserData {
    const known = byId(incoming.id);
    const user =
      incoming.agentAccess === null && known?.agentAccess
        ? { ...incoming, agentAccess: known.agentAccess }
        : incoming;
    users.value = known
      ? users.value.map((u) => (u.id === user.id ? user : u))
      : [...users.value, user];
    return user;
  }

  // Partial change to a known record: an optimistic flip, or a fact another
  // store learned about this account (the access editor's save moves the
  // list's badge through here). Returns a rollback that restores only the
  // fields still holding the patched value, so undoing a guess never undoes
  // something fresher the server said in between.
  function patch(id: string, partial: Partial<IUserData>): () => void {
    const previous = byId(id);
    if (!previous) return () => {};
    users.value = users.value.map((u) =>
      u.id === id ? { ...u, ...partial } : u,
    );
    return () => {
      const current = byId(id);
      if (!current) return;
      const restored: Record<string, unknown> = {};
      for (const key of Object.keys(partial) as (keyof IUserData)[]) {
        if (toRaw(current[key]) === toRaw(partial[key])) restored[key] = previous[key];
      }
      users.value = users.value.map((u) =>
        u.id === id ? { ...u, ...(restored as Partial<IUserData>) } : u,
      );
    };
  }

  async function fetchAll() {
    const generation = accountGeneration;
    const list = await getService().findAll();
    if (generation === accountGeneration) users.value = list;
    return users.value;
  }

  // Upserts what it read; an account that is gone leaves the store as well.
  // Callers render `byId(id)`, not what this returns.
  async function fetchById(id: string) {
    const generation = accountGeneration;
    const user = await getService().findById(id);
    if (generation !== accountGeneration) return null;
    if (!user) {
      users.value = users.value.filter((u) => u.id !== id);
      return null;
    }
    return upsert(user);
  }

  async function create(data: ICreateUserData) {
    const generation = accountGeneration;
    const created = await getService().create(data);
    if (generation === accountGeneration) {
      users.value = [created, ...users.value.filter((u) => u.id !== created.id)];
    }
    return created;
  }

  async function update(id: string, data: IUpdateUserData) {
    const generation = accountGeneration;
    const updated = await getService().update(id, data);
    return generation === accountGeneration ? upsert(updated) : updated;
  }

  async function updateRole(id: string, role: UserRoleTypes) {
    const generation = accountGeneration;
    const updated = await getService().updateRole(id, role);
    return generation === accountGeneration ? upsert(updated) : updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    users.value = users.value.filter((u) => u.id !== id);
  }

  return {
    users,
    byId,
    upsert,
    patch,
    resetForAccount,
    fetchAll,
    fetchById,
    create,
    update,
    updateRole,
    remove,
  };
});
