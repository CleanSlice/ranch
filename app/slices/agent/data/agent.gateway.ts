import { AgentsService } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentGateway } from '../domain/agent.gateway';
import type {
  IAgentCreateInput,
  IAgentData,
  IAgentUpdateInput,
} from '../domain/agent.types';
import { AgentMapper } from './agent.mapper';

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
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }
}
