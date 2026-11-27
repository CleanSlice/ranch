import { StatsService } from '#api';
import type {
  InstallationStatsDto,
  MyStatsDto,
} from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IStatsGateway } from '../domain/stats.gateway';
import {
  StatsForbiddenError,
  type IInstallationStats,
  type IPersonalStats,
} from '../domain/stats.types';
import type { StatsPeriod } from '../utils/statsView';
import { StatsMapper } from './stats.mapper';

/** The message of an error body, when the server put one there. */
function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * The HTTP status of an answer. A refused or failed request comes back as
 * the client's error object, which carries the status on its `response`; an
 * answered one carries it itself.
 */
function statusOf(res: unknown): number | undefined {
  const answer = res as { status?: unknown; response?: { status?: unknown } | null } | null;
  const status = answer?.response?.status ?? answer?.status;
  return typeof status === 'number' ? status : undefined;
}

export class StatsGateway extends BaseGateway implements IStatsGateway {
  private mapper = new StatsMapper();

  getMine(period: StatsPeriod, timeZone: string): Promise<IPersonalStats> {
    return this.execute(async () => {
      const res = await StatsService.getMyStats({ query: { period, tz: timeZone } });
      // The generated client never throws: a 4xx/5xx comes back as
      // `res.error` (the server's body) and a network failure as an answer
      // with no data. Either way there is no view, and the store has to hear
      // of it: a resolved promise would leave the tab on its placeholders for
      // ever, with no Retry. The server's message travels as received; a
      // network failure carries none.
      if (res.error !== undefined && res.error !== null) {
        throw new Error(messageOf(res.error));
      }
      const dto = unwrapEnvelope<MyStatsDto>(res.data);
      if (!dto) throw new Error('');
      return this.mapper.toPersonal(dto);
    });
  }

  getInstallation(period: StatsPeriod): Promise<IInstallationStats> {
    return this.execute(async () => {
      const res = await StatsService.getInstallationStats({ query: { period } });
      // A refusal is told apart by its status, not by its wording: the route
      // answers 403 to anyone who is not the owner or an administrator, and
      // the page has something else to say then than "could not be loaded".
      // Read before `res.error`, which a 403 fills like any other 4xx.
      if (statusOf(res) === 403) {
        throw new StatsForbiddenError(messageOf(res.error));
      }
      if (res.error !== undefined && res.error !== null) {
        throw new Error(messageOf(res.error));
      }
      const dto = unwrapEnvelope<InstallationStatsDto>(res.data);
      if (!dto) throw new Error('');
      return this.mapper.toInstallation(dto);
    });
  }
}
