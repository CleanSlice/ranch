import { ISkillData, ICreateSkillData, IUpdateSkillData } from './skill.types';

export abstract class ISkillGateway {
  abstract findAll(): Promise<ISkillData[]>;
  abstract findById(id: string): Promise<ISkillData | null>;
  abstract findByIds(ids: string[]): Promise<ISkillData[]>;
  abstract create(data: ICreateSkillData): Promise<ISkillData>;
  abstract update(id: string, data: IUpdateSkillData): Promise<ISkillData>;
  abstract delete(id: string): Promise<void>;
}
