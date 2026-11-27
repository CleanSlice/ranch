import { StatsService } from '#api';
import type { MyStatsDto } from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IStatsGateway } from '../domain/stats.gateway';
import type { IPersonalStats } from '../domain/stats.types';
import type { StatsPeriod } from '../utils/statsView';
import { StatsMapper } from './stats.mapper';

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
        const message = (res.error as { message?: unknown }).message;
        throw new Error(typeof message === 'string' ? message : '');
      }
      const dto = unwrapEnvelope<MyStatsDto>(res.data);
      if (!dto) throw new Error('');
      return this.mapper.toPersonal(dto);
    });
  }
}
