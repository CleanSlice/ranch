import { AgentsService } from '#api/data';
import type { AgentToolCatalogDto } from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import type { IAgentToolCatalog } from '../domain/toolCatalog.types';
import { IToolCatalogGateway } from '../domain/toolCatalog.types';
import { ToolCatalogMapper } from './toolCatalog.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * The generated client answers a failed request with `{ error }` rather than
 * throwing; the panel wants the sentence ("Agent not found", a 502), so the
 * error is raised here instead of read as an empty catalogue.
 */
function unwrapOrThrow(res: HeyApiResult, action: string): unknown {
  const err = res.error as { message?: string } | undefined;
  if (err !== undefined && err !== null) {
    const status = res.response?.status;
    if (err.message) throw new Error(err.message);
    if (status && status >= 400) throw new Error(`${action} failed: HTTP ${status}`);
    throw new Error(`${action} failed: could not reach the API.`);
  }
  return unwrapEnvelope(res.data);
}

/** The only place the console reads an agent's tool catalogue (CLEAN-109). */
export class ToolCatalogGateway extends BaseGateway implements IToolCatalogGateway {
  private mapper = new ToolCatalogMapper();

  forAgent(agentId: string): Promise<IAgentToolCatalog> {
    return this.execute(async () => {
      const res = await AgentsService.getAgentTools({ path: { id: agentId } });
      const dto = unwrapOrThrow(res, 'Loading tools') as AgentToolCatalogDto | null;
      if (!dto) throw new Error('Loading tools returned no data');
      return this.mapper.toCatalog(dto);
    });
  }
}
