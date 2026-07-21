import { IAgentStatusGateway } from '../domain/agentStatus.gateway';
import type { IAgentStatusCallbacks } from '../domain/agentStatus.types';
import { AgentStatusMapper } from './agentStatus.mapper';

/**
 * Owns the `/agents/status/stream` EventSource. Opens the stream on the first
 * `subscribe`, forwards decoded frames + connection-state changes to the store's
 * callbacks, and closes on `unsubscribe`. The store does the consumer
 * ref-counting, so subscribe/unsubscribe are called once per open/close cycle.
 */
export class AgentStatusGateway implements IAgentStatusGateway {
  private mapper = new AgentStatusMapper();
  private source: EventSource | null = null;
  private callbacks: IAgentStatusCallbacks | null = null;

  constructor(private getBaseUrl: () => string) {}

  subscribe(callbacks: IAgentStatusCallbacks): void {
    if (!import.meta.client) return;
    this.callbacks = callbacks;
    if (this.source) return;

    callbacks.onConnectionStateChange('connecting');
    const baseUrl = this.getBaseUrl().replace(/\/$/, '');
    this.source = new EventSource(`${baseUrl}/agents/status/stream`);

    this.source.onopen = () => {
      this.callbacks?.onConnectionStateChange('connected');
    };

    this.source.onmessage = (raw: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.data);
      } catch (err) {
        // malformed payload — keep the connection but skip the message
        console.warn('[agentStatus] failed to parse SSE payload', err);
        return;
      }
      const message = this.mapper.toStreamMessage(parsed);
      if (message) this.callbacks?.onMessage(message);
    };

    this.source.onerror = () => {
      // EventSource handles reconnection on its own; reflect intermediate state
      this.callbacks?.onConnectionStateChange('disconnected');
    };
  }

  unsubscribe(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.callbacks = null;
  }
}
