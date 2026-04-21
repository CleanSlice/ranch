import { IUsageData, IReportUsageData } from './usage.types';

export abstract class IUsageGateway {
  abstract report(agentId: string, data: IReportUsageData): Promise<void>;
  abstract findRecentForAgent(
    agentId: string,
    days: number,
  ): Promise<IUsageData[]>;
}
