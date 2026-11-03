import {
  ITemplateData,
  ICreateTemplateData,
  IUpdateTemplateData,
} from './template.types';

export abstract class ITemplateGateway {
  abstract findAll(): Promise<ITemplateData[]>;
  abstract findById(id: string): Promise<ITemplateData | null>;
  abstract create(data: ICreateTemplateData): Promise<ITemplateData>;
  abstract createWithId(
    data: ICreateTemplateData & { id: string },
  ): Promise<ITemplateData>;
  abstract update(
    id: string,
    data: IUpdateTemplateData,
  ): Promise<ITemplateData>;
  abstract setSkills(id: string, skillIds: string[]): Promise<ITemplateData>;
  abstract setMcps(id: string, mcpServerIds: string[]): Promise<ITemplateData>;
  /** Limit the Documents MCP tools the template's agents get; null = every tool (CLEAN-209). */
  abstract setToolAllowlist(
    id: string,
    toolNames: string[] | null,
  ): Promise<ITemplateData>;
  abstract touch(id: string): Promise<ITemplateData>;
  abstract countAgents(id: string): Promise<number>;
  abstract delete(id: string): Promise<void>;
}
