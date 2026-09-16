import type { PeerService } from './domain/peer.service';

declare module '#app' {
  interface NuxtApp {
    $peerService: PeerService;
  }
}

export {};
