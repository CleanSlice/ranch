import type { ITemplateGateway } from './template.gateway';
import type {
  ICreateTemplateData,
  IRestartAgentsResult,
  ITemplateData,
  IUpdateTemplateData,
} from './template.types';

/**
 * Domain service for agent templates. The store layers the reactive template
 * list on top.
 */
export class TemplateService {
  constructor(private gateway: ITemplateGateway) {}

  findAll(): Promise<ITemplateData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<ITemplateData | null> {
    return this.gateway.findById(id);
  }

  create(input: ICreateTemplateData): Promise<ITemplateData> {
    return this.gateway.create(input);
  }

  update(id: string, input: IUpdateTemplateData): Promise<ITemplateData> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  setSkills(id: string, skillIds: string[]): Promise<ITemplateData> {
    return this.gateway.setSkills(id, skillIds);
  }

  setMcps(id: string, mcpServerIds: string[]): Promise<ITemplateData> {
    return this.gateway.setMcps(id, mcpServerIds);
  }

  restartAgents(templateId: string): Promise<IRestartAgentsResult> {
    return this.gateway.restartAgents(templateId);
  }
}
