import type { StatsPeriod } from '../utils/statsView';
import type { IInstallationStats, IPersonalStats } from './stats.types';

/**
 * The contract the domain depends on. The data layer provides the concrete
 * implementation (`StatsGateway`); the service and the store know only this
 * abstraction, so the SDK stays swappable and a test can stand in for it.
 */
export abstract class IStatsGateway {
  /**
   * The signed-in person's own figures for the last `period` days and the
   * period before. `timeZone` is the viewer's IANA zone: their days are cut on
   * their own clock. Throws when the view could not be read.
   */
  abstract getMine(period: StatsPeriod, timeZone: string): Promise<IPersonalStats>;

  /**
   * The installation's figures for the last `period` days and the period
   * before, over the agents the caller reaches. No time zone: its days are
   * UTC days for every viewer. Throws `StatsForbiddenError` when the route
   * refuses the caller (anyone but the owner and administrators), and any
   * other error when the view could not be read.
   */
  abstract getInstallation(period: StatsPeriod): Promise<IInstallationStats>;
}
