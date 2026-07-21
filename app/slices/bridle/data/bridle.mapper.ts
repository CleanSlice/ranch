import type { IBridleReply } from '../domain/bridle.types';

/**
 * Maps the agent runtime's sync response onto the domain reply. The SDK types
 * this endpoint's body as `unknown`, so we defensively read the three fields
 * we care about and normalize `text` to a string. Time/id fallbacks are left to
 * the store (they depend on "now").
 */
export class BridleMapper {
  toReply(raw: unknown): IBridleReply {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      messageId: typeof o.messageId === 'string' ? o.messageId : null,
      text: typeof o.text === 'string' ? o.text : '',
      ts: typeof o.ts === 'number' ? o.ts : null,
    };
  }
}
