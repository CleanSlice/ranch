import { parseStatusMessage, type IAgentStatusMessage } from '../utils/statusFrame';

export type AgentStatusConnectionTypes =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

export interface IAgentStatusCallbacks {
  onMessage: (message: IAgentStatusMessage) => void;
  onConnectionStateChange: (state: AgentStatusConnectionTypes) => void;
}

/**
 * Owns the `/agents/status/stream` EventSource (CLEAN-247), as the admin
 * console's gateway of the same name does. The stream is public, since an
 * EventSource cannot send an Authorization header, and carries status facts
 * only. The store does the consumer counting, so `subscribe` and
 * `unsubscribe` are called once per open/close cycle.
 */
export class AgentStatusGateway {
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
      } catch {
        // A malformed payload: keep the connection, skip the message.
        return;
      }
      const message = parseStatusMessage(parsed);
      if (message) this.callbacks?.onMessage(message);
    };

    this.source.onerror = () => {
      // EventSource reconnects on its own; this is the state meanwhile.
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
