import { IUserData, ICreateUserData, IUpdateUserData } from './user.types';

export abstract class IUserGateway {
  abstract findAll(): Promise<IUserData[]>;
  abstract findById(id: string): Promise<IUserData | null>;
  abstract create(data: ICreateUserData): Promise<IUserData>;
  abstract update(id: string, data: IUpdateUserData): Promise<IUserData>;
  abstract delete(id: string): Promise<void>;
}
