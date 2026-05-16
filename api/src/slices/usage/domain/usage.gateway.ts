import { IUsageData, IReportUsageData } from './usage.types';

export abstract class IUsageGateway {
  abstract report(agentId: string, data: IReportUsageData): Promise<void>;
  abstract findRecentForAgent(
    agentId: string,
    days: number,
  ): Promise<IUsageData[]>;
  /**
   * All usage rows that reference the given LlmCredential within the last
   * N days. Used to roll up per-credential spend across agents.
   */
  abstract findRecentForCredential(
    credentialId: string,
    days: number,
  ): Promise<IUsageData[]>;
}
