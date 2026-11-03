import {
  ISkillData,
  ICreateSkillData,
  IUpdateSkillData,
  ISkillDependentAgent,
  ISkillOrderItem,
} from './skill.types';

export abstract class ISkillGateway {
  abstract findAll(): Promise<ISkillData[]>;
  abstract findById(id: string): Promise<ISkillData | null>;
  abstract findByName(name: string): Promise<ISkillData | null>;
  abstract findByIds(ids: string[]): Promise<ISkillData[]>;
  abstract create(data: ICreateSkillData): Promise<ISkillData>;
  abstract update(id: string, data: IUpdateSkillData): Promise<ISkillData>;
  abstract delete(id: string): Promise<void>;
  abstract findDependentAgents(id: string): Promise<ISkillDependentAgent[]>;
  /** Every skill's position, by `sortOrder` then name (CLEAN-205). */
  abstract readOrder(): Promise<ISkillOrderItem[]>;
  /**
   * Replace every position in one transaction. `guard` sees the rows as they
   * are at that moment, locked, and throws to abort — the order service uses
   * it to refuse a save made against a version that has moved on. The write
   * does not touch `updatedAt`: a reorder is not an edit.
   */
  abstract writeOrder(
    items: ISkillOrderItem[],
    guard: (current: ISkillOrderItem[]) => void,
  ): Promise<void>;
}
