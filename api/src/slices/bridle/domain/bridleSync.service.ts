import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IBridleGateway } from './bridle.gateway';
import type {
  BridlePart,
  IBridleAttachment,
  IBridleUserIdentity,
} from './bridle.types';

/** Same ceiling the synchronous chat route has always used. */
export const DEFAULT_SYNC_TIMEOUT_MS = 120_000;

export interface ISendAndAwaitInput {
  agentId: string;
  /** Conversation identity. Decides history, access and continuity. */
  clientId: string;
  text: string;
  parts?: BridlePart[];
  attachments?: IBridleAttachment[];
  /**
   * What the caller can render. The runtime gates optional output on this:
   * a caller that cannot show thinking steps must not declare `'thinking'`,
   * or the agent streams a timeline into a void.
   */
  capabilities?: string[];
  isAdmin?: boolean;
  /** The console login behind the call, forwarded to the agent (CLEAN-80). */
  user?: IBridleUserIdentity;
  timeoutMs?: number;
}

export interface ISendAndAwaitResult {
  text: string;
  messageId: string;
  ts: number;
  /** True when the wait ran out. `text` then holds whatever had streamed in. */
  timedOut: boolean;
}

/**
 * "Send one message to an agent and wait for its answer."
 *
 * This lived inline in the HTTP controller, which was fine while HTTP was the
 * only caller. The A2A server (CLEAN-74) needs the same wait without being a
 * controller: an inbound task from a peer agent has to reach the runtime and
 * come back as one reply. Extracting it keeps one implementation of the
 * register/resolve/timeout dance rather than a copy that drifts.
 *
 * The one behavioural difference from the old inline code is that a timeout is
 * reported as a flag instead of a fixed sentence. The HTTP route still renders
 * its own sentence; A2A turns the flag into a failed task with a stated cause,
 * because a peer that answers "Timeout: no response from agent" as if it were
 * an answer is exactly the silent failure this feature must not have.
 */
@Injectable()
export class BridleSyncService {
  constructor(private readonly hub: IBridleGateway) {}

  sendAndAwait(input: ISendAndAwaitInput): Promise<ISendAndAwaitResult> {
    const {
      agentId,
      clientId,
      text,
      parts = [],
      attachments,
      capabilities = [],
      isAdmin = false,
      user,
      timeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    } = input;

    // Distinct from clientId: this call shares the clientId+agentId map key
    // with any concurrently-open WS session for the same visitor (e.g. the
    // chat widget open in another tab), so registerClient/unregisterClient
    // need their own socket-equivalent identity to avoid one call's cleanup
    // wiping the other's live registration.
    const socketId = 'sync-' + crypto.randomUUID();
    const chunks: string[] = [];

    return new Promise<ISendAndAwaitResult>((resolve) => {
      let settled = false;
      const finish = (result: ISendAndAwaitResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.hub.unregisterClient(clientId, agentId, socketId);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          text: chunks.join(''),
          messageId: '',
          ts: Date.now(),
          timedOut: true,
        });
      }, timeoutMs);

      this.hub.registerClient(
        clientId,
        agentId,
        socketId,
        (data: unknown) => {
          const event = data as Record<string, unknown>;
          if (event.type === 'message' || event.type === 'stream_end') {
            finish({
              text: (event.text as string) ?? chunks.join(''),
              messageId: (event.messageId as string) ?? '',
              ts: (event.ts as number) ?? Date.now(),
              timedOut: false,
            });
          } else if (event.type === 'stream') {
            chunks.push((event.text as string) ?? '');
          }
        },
        isAdmin,
        undefined,
        capabilities,
        user,
      );

      // `socketId` makes this call's own capabilities travel with the message
      // now that a conversation can hold several sockets at once.
      this.hub.sendToAgent(clientId, agentId, text, parts, attachments, {
        socketId,
      });
    });
  }
}
