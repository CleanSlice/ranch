import type { StatsPeriod } from '../utils/statsView';
import type { IStatsGateway } from './stats.gateway';
import type { IInstallationStats, IPersonalStats } from './stats.types';

/**
 * Domain service for the profile's statistics: the use-case surface the store
 * consumes, as in the other slices. It delegates straight to the gateway:
 * one call for the person's own view, one for the installation's.
 */
export class ProfileStatsService {
  constructor(private gateway: IStatsGateway) {}

  getMine(period: StatsPeriod, timeZone: string): Promise<IPersonalStats> {
    return this.gateway.getMine(period, timeZone);
  }

  getInstallation(period: StatsPeriod): Promise<IInstallationStats> {
    return this.gateway.getInstallation(period);
  }
}
