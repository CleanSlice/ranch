import { ShareGateway } from '../data/share.gateway';
import { ShareService } from '../domain/share.service';

/**
 * Composition root for the share slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$shareService`.
 */
export default defineNuxtPlugin({
  name: 'share-di',
  setup() {
    const service = new ShareService(new ShareGateway());
    return {
      provide: {
        shareService: service,
      },
    };
  },
});
