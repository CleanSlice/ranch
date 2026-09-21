import { ShareGateway } from '../data/share.gateway';
import { ShareService } from '../domain/share.service';

/**
 * Composition root for the share slice. Provides `$shareService`.
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
