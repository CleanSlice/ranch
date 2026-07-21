import { SecretsService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentSecretGateway } from '../domain/agentSecret.gateway';
import type { ISecretListData } from '../domain/agentSecret.types';
import { AgentSecretMapper } from './agentSecret.mapper';

export class AgentSecretGateway
  extends BaseGateway
  implements IAgentSecretGateway
{
  private mapper = new AgentSecretMapper();

  list(agentId: string): Promise<ISecretListData | null> {
    return this.execute(async () => {
      const res = await SecretsService.secretControllerList({
        path: { agentId },
      });
      return this.mapper.toListData(unwrapEnvelope(res.data));
    });
  }

  set(agentId: string, key: string, value: string): Promise<ISecretListData> {
    return this.execute(async () => {
      const res = await SecretsService.secretControllerSet({
        path: { agentId },
        body: { key, value },
      });
      return this.applyOrThrow(res);
    });
  }

  remove(agentId: string, key: string): Promise<ISecretListData> {
    return this.execute(async () => {
      const res = await SecretsService.secretControllerDelete({
        path: { agentId },
        body: { key },
      });
      return this.applyOrThrow(res);
    });
  }

  replaceAll(
    agentId: string,
    store: Record<string, string>,
  ): Promise<ISecretListData> {
    return this.execute(async () => {
      const res = await SecretsService.secretControllerReplace({
        path: { agentId },
        body: { store },
      });
      return this.applyOrThrow(res);
    });
  }

  // Mutations return the refreshed list; hey-api doesn't throw, so surface the
  // API's error message when the payload is missing.
  private applyOrThrow(res: { data?: unknown; error?: unknown }): ISecretListData {
    const mapped = this.mapper.toListData(unwrapEnvelope(res.data));
    if (mapped) return mapped;
    const err = res.error as { message?: string } | undefined;
    throw new Error(err?.message || 'Secret operation failed');
  }
}
