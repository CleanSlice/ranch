import { UsersService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export enum UserRoleTypes {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export enum UserStatusTypes {
  Active = 'active',
  Invited = 'invited',
  Disabled = 'disabled',
}

export interface IUserData {
  id: string;
  name: string;
  email: string;
  role: UserRoleTypes;
  status: UserStatusTypes;
  createdAt: string;
}

export interface ICreateUserData {
  name: string;
  email: string;
  password: string;
  role: UserRoleTypes;
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

  async function remove(id: string) {
    await UsersService.userControllerRemove({ path: { id } });
    users.value = users.value.filter((u) => u.id !== id);
  }

  return { users, fetchAll, fetchById, create, remove };
});
