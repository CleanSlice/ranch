import { StatsGateway } from '../data/stats.gateway';
import { ProfileStatsService } from '../domain/stats.service';

/**
 * Composition root for the profile slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as
 * `$profileStatsService`. The store resolves it lazily via
 * `createServiceGetter`.
 */
export default defineNuxtPlugin({
  name: 'profile-di',
  setup() {
    const service = new ProfileStatsService(new StatsGateway());
    return {
      provide: {
        profileStatsService: service,
      },
    };
  },
});
