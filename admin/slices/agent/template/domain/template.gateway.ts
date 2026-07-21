import type {
  ICreateTemplateData,
  IRestartAgentsResult,
  ITemplateData,
  IUpdateTemplateData,
} from './template.types';

/**
 * Contract for the templates API. Implemented by `TemplateGateway`.
 * `restartAgents` hits the agent controller (to avoid a Template↔Agent module
 * cycle server-side) but lives here so the store stays SDK-free.
 */
export abstract class ITemplateGateway {
  abstract findAll(): Promise<ITemplateData[]>;
  abstract findById(id: string): Promise<ITemplateData | null>;
  abstract create(input: ICreateTemplateData): Promise<ITemplateData>;
  abstract update(id: string, input: IUpdateTemplateData): Promise<ITemplateData>;
  abstract remove(id: string): Promise<void>;
  abstract setSkills(id: string, skillIds: string[]): Promise<ITemplateData>;
  abstract setMcps(id: string, mcpServerIds: string[]): Promise<ITemplateData>;
  abstract restartAgents(templateId: string): Promise<IRestartAgentsResult>;
}
