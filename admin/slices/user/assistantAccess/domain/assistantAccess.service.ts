import type { IAssistantAccessGateway } from './assistantAccess.gateway';
import type {
  AssistantRole,
  IAssistantAccountData,
  IAssistantCatalog,
  IAssistantOverview,
  IAssistantRoleData,
  IMyAssistantAccess,
  ISetAssistantInput,
} from './assistantAccess.types';

export class AssistantAccessService {
  constructor(private gateway: IAssistantAccessGateway) {}

  overview(): Promise<IAssistantOverview> {
    return this.gateway.overview();
  }

  catalog(): Promise<IAssistantCatalog> {
    return this.gateway.catalog();
  }

  setRole(
    role: AssistantRole,
    input: ISetAssistantInput,
  ): Promise<Omit<IAssistantRoleData, 'accounts'>> {
    return this.gateway.setRole(role, input);
  }

  account(userId: string): Promise<IAssistantAccountData> {
    return this.gateway.account(userId);
  }

  setAccount(
    userId: string,
    input: ISetAssistantInput,
  ): Promise<IAssistantAccountData> {
    return this.gateway.setAccount(userId, input);
  }

  resetAccount(userId: string): Promise<IAssistantAccountData> {
    return this.gateway.resetAccount(userId);
  }

  mine(): Promise<IMyAssistantAccess> {
    return this.gateway.mine();
  }
}
