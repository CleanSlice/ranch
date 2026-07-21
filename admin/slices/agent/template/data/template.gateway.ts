import { AgentsService, TemplatesService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ITemplateGateway } from '../domain/template.gateway';
import type {
  ICreateTemplateData,
  IRestartAgentsResult,
  ITemplateData,
  IUpdateTemplateData,
} from '../domain/template.types';
import { TemplateMapper } from './template.mapper';

function errorMessage(res: { error?: unknown }): string | null {
  const err = res.error;
  if (err === undefined || err === null) return null;
  return (err as { message?: string }).message ?? '';
}

export class TemplateGateway extends BaseGateway implements ITemplateGateway {
  private mapper = new TemplateMapper();

  findAll(): Promise<ITemplateData[]> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<ITemplateData | null> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerFindById({
        path: { id },
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateTemplateData): Promise<ITemplateData> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.entityOrThrow(res, 'Template create');
    });
  }

  update(id: string, input: IUpdateTemplateData): Promise<ITemplateData> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.entityOrThrow(res, 'Template update');
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerRemove({
        path: { id },
      });
      const msg = errorMessage(res);
      if (msg !== null) throw new Error(msg || 'Failed to delete template');
    });
  }

  setSkills(id: string, skillIds: string[]): Promise<ITemplateData> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerSetSkills({
        path: { id },
        body: { skillIds },
      });
      return this.entityOrThrow(res, 'Set skills');
    });
  }

  setMcps(id: string, mcpServerIds: string[]): Promise<ITemplateData> {
    return this.execute(async () => {
      const res = await TemplatesService.templateControllerSetMcps({
        path: { id },
        body: { mcpServerIds },
      });
      return this.entityOrThrow(res, 'Set MCPs');
    });
  }

  restartAgents(templateId: string): Promise<IRestartAgentsResult> {
    return this.execute(async () => {
      const res = await AgentsService.restartByTemplate({
        path: { templateId },
      });
      const msg = errorMessage(res);
      if (msg !== null) throw new Error(msg || 'Failed to restart agents');
      return this.mapper.toRestartResult(unwrapEnvelope(res.data));
    });
  }

  private entityOrThrow(res: { data?: unknown }, action: string): ITemplateData {
    const entity = this.mapper.toEntity(unwrapEnvelope(res.data));
    if (!entity) throw new Error(`${action} returned no template data`);
    return entity;
  }
}
