import type { IMyAssistantAccess } from './assistantAccess.types';

export abstract class IAssistantAccessGateway {
  abstract mine(): Promise<IMyAssistantAccess>;
}
