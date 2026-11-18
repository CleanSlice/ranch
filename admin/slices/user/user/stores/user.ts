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

  async function fetchAll() {
    const generation = accountGeneration;
    const list = await getService().findAll();
    if (generation === accountGeneration) users.value = list;
    return users.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(data: ICreateUserData) {
    const created = await getService().create(data);
    users.value = [created, ...users.value];
    return created;
  }

  async function update(id: string, data: IUpdateUserData) {
    const updated = await getService().update(id, data);
    users.value = users.value.map((u) => (u.id === id ? updated : u));
    return updated;
  }

  async function updateRole(id: string, role: UserRoleTypes) {
    const updated = await getService().updateRole(id, role);
    users.value = users.value.map((u) => (u.id === id ? updated : u));
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    users.value = users.value.filter((u) => u.id !== id);
  }

  return {
    users,
    resetForAccount,
    fetchAll,
    fetchById,
    create,
    update,
    updateRole,
    remove,
  };
});
