import { McpServersService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IMcpServerGateway } from '../domain/mcpServer.gateway';
import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
} from '../domain/mcpServer.types';
import { McpServerMapper } from './mcpServer.mapper';

export class McpServerGateway extends BaseGateway implements IMcpServerGateway {
  private mapper = new McpServerMapper();

  findAll(): Promise<IMcpServerData[]> {
    return this.execute(async () => {
      const res = await McpServersService.mcpServerControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<IMcpServerData | null> {
    return this.execute(async () => {
      const res = await McpServersService.mcpServerControllerFindById({
        path: { id },
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateMcpServerData): Promise<IMcpServerData> {
    return this.execute(async () => {
      const res = await McpServersService.mcpServerControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.entityOrThrow(res.data, 'MCP server create');
    });
  }

  update(id: string, input: IUpdateMcpServerData): Promise<IMcpServerData> {
    return this.execute(async () => {
      const res = await McpServersService.mcpServerControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.entityOrThrow(res.data, 'MCP server update');
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await McpServersService.mcpServerControllerRemove({ path: { id } });
    });
  }

  private entityOrThrow(data: unknown, action: string): IMcpServerData {
    const entity = this.mapper.toEntity(unwrapEnvelope(data));
    if (!entity) throw new Error(`${action} returned no data`);
    return entity;
  }
}
