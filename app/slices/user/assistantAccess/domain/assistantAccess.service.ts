import type { IAssistantAccessGateway } from './assistantAccess.gateway';
import type { IMyAssistantAccess } from './assistantAccess.types';

export class AssistantAccessService {
  constructor(private gateway: IAssistantAccessGateway) {}

  mine(): Promise<IMyAssistantAccess> {
    return this.gateway.mine();
  }
}
