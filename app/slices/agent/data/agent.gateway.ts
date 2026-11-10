import { AgentsService, PeersService } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentGateway } from '../domain/agent.gateway';
import type {
  IAgentCreateInput,
  IAgentData,
  IAgentLinkData,
  IAgentUpdateInput,
  IClusterCapacityData,
} from '../domain/agent.types';
import { AgentMapper } from './agent.mapper';

interface IHeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * The generated client never throws: a 4xx/5xx comes back as `res.error` (the
 * server's body) and a network failure as an empty `{}`. The mutations the
 * sheet drives optimistically need a thrown error, or the store never rolls
 * the status back and the sheet has nothing to show — an aborted stop left
 * the node reading "stopped" while the agent kept running. The server's
 * message travels as received; a network failure carries none, so the sheet
 * shows only its own title. `response.status` stays on the error for the 401
 * check in useAgentControls.
 */
function unwrapOrThrow<T>(res: IHeyApiResult): T | null {
  if (res.error !== undefined && res.error !== null) {
    const message = (res.error as { message?: unknown }).message;
    const err = new Error(typeof message === 'string' ? message : '') as Error & {
      response?: { status?: number };
    };
    err.response = { status: res.response?.status };
    throw err;
  }
  return unwrapEnvelope<T>(res.data);
}

export class AgentGateway extends BaseGateway implements IAgentGateway {
  private mapper = new AgentMapper();

  findAll(): Promise<IAgentData[]> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findPublic(): Promise<IAgentData[]> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindPublic();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindById({ path: { id } });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: IAgentCreateInput): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  update(id: string, input: IAgentUpdateInput): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      // `wipeS3` is required by the SDK type; default to non-destructive so a
      // plain delete never wipes the agent's S3 data.
      await AgentsService.agentControllerRemove({
        path: { id },
        query: { wipeS3: 'false' },
      });
    });
  }

  restart(id: string): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerRestart({ path: { id } });
      return this.mapper.toEntity(unwrapOrThrow(res));
    });
  }

  stop(id: string): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerStop({ path: { id } });
      return this.mapper.toEntity(unwrapOrThrow(res));
    });
  }

  start(id: string): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerStart({ path: { id } });
      return this.mapper.toEntity(unwrapOrThrow(res));
    });
  }

  getCapacity(): Promise<IClusterCapacityData | null> {
    return this.execute(async () => {
      const res = await AgentsService.getClusterCapacity();
      return this.mapper.toCapacity(unwrapEnvelope(res.data));
    });
  }

  getLinks(): Promise<IAgentLinkData[]> {
    return this.execute(async () => {
      const res = await PeersService.listAgentLinks();
      return this.mapper.toLinks(unwrapEnvelope(res.data));
    });
  }
}
