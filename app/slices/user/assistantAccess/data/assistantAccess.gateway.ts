import { AssistantAccessService as AssistantAccessApi } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAssistantAccessGateway } from '../domain/assistantAccess.gateway';
import type { IMyAssistantAccess } from '../domain/assistantAccess.types';
import { AssistantAccessMapper } from './assistantAccess.mapper';

export class AssistantAccessUnreadableError extends Error {
  constructor() {
    super('The assistant level could not be read.');
    this.name = 'AssistantAccessUnreadableError';
  }
}

export class AssistantAccessGateway
  extends BaseGateway
  implements IAssistantAccessGateway
{
  private mapper = new AssistantAccessMapper();

  mine(): Promise<IMyAssistantAccess> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.getMyAssistantAccess({
        throwOnError: true,
      });
      const mine = this.mapper.toMine(unwrapEnvelope(res.data));
      if (!mine) throw new AssistantAccessUnreadableError();
      return mine;
    });
  }
}
