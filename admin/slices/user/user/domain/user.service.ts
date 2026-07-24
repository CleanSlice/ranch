import type { IUserGateway } from './user.gateway';
import type {
  ICreateUserData,
  IUpdateUserData,
  IUserData,
  UserRoleTypes,
} from './user.types';

/** Domain service for platform users. The store layers the reactive list. */
export class UserService {
  constructor(private gateway: IUserGateway) {}

  findAll(): Promise<IUserData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<IUserData | null> {
    return this.gateway.findById(id);
  }

  create(input: ICreateUserData): Promise<IUserData> {
    return this.gateway.create(input);
  }

  update(id: string, input: IUpdateUserData): Promise<IUserData> {
    return this.gateway.update(id, input);
  }

  updateRole(id: string, role: UserRoleTypes): Promise<IUserData> {
    return this.gateway.updateRole(id, role);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }
}
