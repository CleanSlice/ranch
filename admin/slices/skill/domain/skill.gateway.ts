import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  ISkillData,
  ISkillDependentAgent,
  ISkillInput,
  ISkillSearchHit,
} from './skill.types';

/** Contract for the skills API. Implemented by `SkillGateway`. */
export abstract class ISkillGateway {
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
