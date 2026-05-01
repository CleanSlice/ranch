import { UsersService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
}

export const ALL_USER_ROLES: UserRoleTypes[] = [
  UserRoleTypes.Owner,
  UserRoleTypes.Admin,
  UserRoleTypes.User,
];

export enum UserStatusTypes {
  Active = 'active',
  Invited = 'invited',
  Disabled = 'disabled',
}

export interface IUserData {
  id: string;
  name: string;
  email: string;
  roles: UserRoleTypes[];
  status: UserStatusTypes;
  createdAt: string;
}

export interface ICreateUserData {
  name: string;
  email: string;
  password: string;
  roles: UserRoleTypes[];
}

export const useUserStore = defineStore('user', () => {
  const users = ref<IUserData[]>([]);

  async function fetchAll() {
    const res = await UsersService.userControllerFindAll();
    const env = res.data as ApiEnvelope<IUserData[]> | undefined;
    users.value = env?.data ?? [];
    return users.value;
  }

  async function fetchById(id: string) {
    const res = await UsersService.userControllerFindById({ path: { id } });
    const env = res.data as ApiEnvelope<IUserData | null> | undefined;
    return env?.data ?? null;
  }

  async function create(data: ICreateUserData) {
    const res = await UsersService.userControllerCreate({ body: data });
    const env = res.data as ApiEnvelope<IUserData>;
    users.value = [env.data, ...users.value];
    return env.data;
  }

  async function updateRoles(id: string, roles: UserRoleTypes[]) {
    const res = await UsersService.userControllerUpdateRoles({
      path: { id },
      body: { roles },
    });
    const env = res.data as ApiEnvelope<IUserData>;
    users.value = users.value.map((u) => (u.id === id ? env.data : u));
    return env.data;
  }

  async function remove(id: string) {
    await UsersService.userControllerRemove({ path: { id } });
    users.value = users.value.filter((u) => u.id !== id);
  }

  return { users, fetchAll, fetchById, create, updateRoles, remove };
});
