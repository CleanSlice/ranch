import type { ISkillGateway } from './skill.gateway';
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

/** Domain service for skills. The store layers list/loading/error + caching. */
export class SkillService {
  constructor(private gateway: ISkillGateway) {}

  fetchOrder(): Promise<ISkillOrder> {
    return this.gateway.fetchOrder();
  }

  saveOrder(order: ISkillOrder): Promise<ISkillOrder> {
    return this.gateway.saveOrder(order);
  }

  isNameAvailable(name: string, excludeId?: string): Promise<INameAvailability> {
    return this.gateway.isNameAvailable(name, excludeId);
  }

  findAll(): Promise<ISkillData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<ISkillData | null> {
    return this.gateway.findById(id);
  }

  create(input: ISkillInput): Promise<ISkillData | null> {
    return this.gateway.create(input);
  }

  update(id: string, input: Partial<ISkillInput>): Promise<ISkillData | null> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  search(q: string): Promise<ISkillSearchHit[]> {
    return this.gateway.search(q);
  }

  importFromGithub(input: IImportFromGithubInput): Promise<ISkillData | null> {
    return this.gateway.importFromGithub(input);
  }

  importFromUrl(input: IImportFromUrlInput): Promise<ISkillData | null> {
    return this.gateway.importFromUrl(input);
  }

  findDependentAgents(id: string): Promise<ISkillDependentAgent[]> {
    return this.gateway.findDependentAgents(id);
  }
}
