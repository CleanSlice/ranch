import { UsageService as UsageApi } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IUsageGateway } from '../domain/usage.gateway';
import type { IAgentUsage } from '../domain/usage.types';
import { UsageMapper } from './usage.mapper';

export class UsageGateway extends BaseGateway implements IUsageGateway {
  private mapper = new UsageMapper();

  findForAgent(agentId: string): Promise<IAgentUsage | null> {
    return this.execute(async () => {
      const res = await UsageApi.usageControllerFindForAgent({
        path: { agentId },
      });
      return this.mapper.toAgentUsage(unwrapEnvelope(res.data));
    });
  }
}
