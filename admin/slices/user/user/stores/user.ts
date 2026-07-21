import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateUserData,
  IUpdateUserData,
  IUserData,
  UserRoleTypes,
  UserService,
} from '#user/domain';

// Re-export the domain enums/types so consumers importing them from
// `#user/stores/user` (user Form/Provider, userList/Create/Edit) keep working.
// The enums are used as runtime values, so they're value re-exports.
export { ALL_USER_ROLES, UserRoleTypes, UserStatusTypes } from '#user/domain';
export type { ICreateUserData, IUpdateUserData, IUserData } from '#user/domain';

const getService = createServiceGetter<UserService>('$userService');

export const useUserStore = defineStore('user', () => {
  const users = ref<IUserData[]>([]);

  async function fetchAll() {
    users.value = await getService().findAll();
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

  async function updateRoles(id: string, roles: UserRoleTypes[]) {
    const updated = await getService().updateRoles(id, roles);
    users.value = users.value.map((u) => (u.id === id ? updated : u));
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    users.value = users.value.filter((u) => u.id !== id);
  }

  return { users, fetchAll, fetchById, create, update, updateRoles, remove };
});
