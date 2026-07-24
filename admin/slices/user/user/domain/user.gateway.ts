import type {
  ICreateUserData,
  IUpdateUserData,
  IUserData,
  UserRoleTypes,
} from './user.types';

/** Contract for the users API. Implemented by `UserGateway`. */
export abstract class IUserGateway {
  abstract findAll(): Promise<IUserData[]>;
  abstract findById(id: string): Promise<IUserData | null>;
  abstract create(input: ICreateUserData): Promise<IUserData>;
  abstract update(id: string, input: IUpdateUserData): Promise<IUserData>;
  abstract updateRole(id: string, role: UserRoleTypes): Promise<IUserData>;
  abstract remove(id: string): Promise<void>;
}
