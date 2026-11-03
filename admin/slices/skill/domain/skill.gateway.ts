import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  INameAvailability,
  ISkillData,
  ISkillDependentAgent,
  ISkillInput,
  ISkillOrder,
  ISkillSearchHit,
} from './skill.types';

/** Contract for the skills API. Implemented by `SkillGateway`. */
export abstract class ISkillGateway {
  /** The shared library order with its version (CLEAN-205). */
  abstract fetchOrder(): Promise<ISkillOrder>;
  /** Replace the whole order; rejects with `ISkillOrderConflict` on 409. */
  abstract saveOrder(order: ISkillOrder): Promise<ISkillOrder>;
  /** Whether a slug is free; `excludeId` keeps an edited skill's own name out. */
  abstract isNameAvailable(name: string, excludeId?: string): Promise<INameAvailability>;
  abstract findAll(): Promise<ISkillData[]>;
  abstract findById(id: string): Promise<ISkillData | null>;
  abstract create(input: ISkillInput): Promise<ISkillData | null>;
  abstract update(
    id: string,
    input: Partial<ISkillInput>,
  ): Promise<ISkillData | null>;
  abstract remove(id: string): Promise<void>;
  abstract search(q: string): Promise<ISkillSearchHit[]>;
  abstract importFromGithub(
    input: IImportFromGithubInput,
  ): Promise<ISkillData | null>;
  abstract importFromUrl(input: IImportFromUrlInput): Promise<ISkillData | null>;
  abstract findDependentAgents(id: string): Promise<ISkillDependentAgent[]>;
}
