import { PeerGateway } from '../data/peer.gateway';
import { PeerService } from '../domain/peer.service';

/**
 * Composition root for the peer slice. Provides `$peerService`.
 */
export default defineNuxtPlugin({
  name: 'agent-peer-di',
  setup() {
    const service = new PeerService(new PeerGateway());
    return {
      provide: {
        peerService: service,
      },
    };
  },
});
