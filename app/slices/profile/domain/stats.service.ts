import type { StatsPeriod } from '../utils/statsView';
import type { IStatsGateway } from './stats.gateway';
import type { IPersonalStats } from './stats.types';

/**
 * Domain service for the profile's statistics: the use-case surface the store
 * consumes, as in the other slices. Today it delegates straight to the
 * gateway; the installation view joins here with its own call.
 */
export class ProfileStatsService {
  constructor(private gateway: IStatsGateway) {}

  getMine(period: StatsPeriod, timeZone: string): Promise<IPersonalStats> {
    return this.gateway.getMine(period, timeZone);
  }
}
