import type {
  AssistantRole,
  IAssistantAccountData,
  IAssistantCatalog,
  IAssistantOverview,
  IAssistantRoleData,
  IMyAssistantAccess,
  ISetAssistantInput,
} from './assistantAccess.types';

export abstract class IAssistantAccessGateway {
  abstract overview(): Promise<IAssistantOverview>;
  abstract catalog(): Promise<IAssistantCatalog>;
  abstract setRole(
    role: AssistantRole,
    input: ISetAssistantInput,
  ): Promise<Omit<IAssistantRoleData, 'accounts'>>;
  abstract account(userId: string): Promise<IAssistantAccountData>;
  abstract setAccount(
    userId: string,
    input: ISetAssistantInput,
  ): Promise<IAssistantAccountData>;
  abstract resetAccount(userId: string): Promise<IAssistantAccountData>;
  abstract mine(): Promise<IMyAssistantAccess>;
}
