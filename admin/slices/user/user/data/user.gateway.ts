import { UsersService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IUserGateway } from '../domain/user.gateway';
import type {
  ICreateUserData,
  IUpdateUserData,
  IUserData,
  UserRoleTypes,
} from '../domain/user.types';
import { UserMapper } from './user.mapper';

export class UserGateway extends BaseGateway implements IUserGateway {
  private mapper = new UserMapper();

  findAll(): Promise<IUserData[]> {
    return this.execute(async () => {
      const res = await UsersService.userControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<IUserData | null> {
    return this.execute(async () => {
      const res = await UsersService.userControllerFindById({ path: { id } });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateUserData): Promise<IUserData> {
    return this.execute(async () => {
      const res = await UsersService.userControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.entityOrThrow(res.data, 'User create');
    });
  }

  update(id: string, input: IUpdateUserData): Promise<IUserData> {
    return this.execute(async () => {
      const res = await UsersService.userControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.entityOrThrow(res.data, 'User update');
    });
  }

  updateRole(id: string, role: UserRoleTypes): Promise<IUserData> {
    return this.execute(async () => {
      const res = await UsersService.userControllerUpdateRole({
        path: { id },
        body: { role: this.mapper.toRoleBody(role) },
      });
      return this.entityOrThrow(res.data, 'Update role');
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await UsersService.userControllerRemove({ path: { id } });
    });
  }

  private entityOrThrow(data: unknown, action: string): IUserData {
    const entity = this.mapper.toEntity(unwrapEnvelope(data));
    if (!entity) throw new Error(`${action} returned no data`);
    return entity;
  }
}
