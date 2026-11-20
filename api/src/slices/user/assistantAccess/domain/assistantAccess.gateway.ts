import type {
  AssistantRole,
  IAssistantAccountData,
  IAssistantSettingData,
} from './assistantAccess.types';

export type IAssistantSettingWrite = Pick<
  IAssistantSettingData,
  'enabled' | 'level' | 'custom' | 'updatedById'
>;

/** The two tables behind the assistant's settings (CLEAN-240). */
export abstract class IAssistantAccessGateway {
  abstract findRole(role: AssistantRole): Promise<IAssistantSettingData | null>;

  abstract saveRole(
    role: AssistantRole,
    data: IAssistantSettingWrite,
  ): Promise<IAssistantSettingData>;

  abstract findAccount(userId: string): Promise<IAssistantAccountData | null>;

  abstract listAccounts(): Promise<IAssistantAccountData[]>;

  abstract saveAccount(
    userId: string,
    data: IAssistantSettingWrite,
  ): Promise<IAssistantAccountData>;

  /** True when there was a row to remove. */
  abstract deleteAccount(userId: string): Promise<boolean>;
}
