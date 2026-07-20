// Domain types for the bridle slice — the live agent chat. Envelope-free; the
// data layer maps the SDK response onto these and the store owns the reactive
// conversation state.

export enum BridleRoleTypes {
  User = 'user',
  Agent = 'agent',
}

export interface IBridleMessage {
  id: string;
  role: BridleRoleTypes;
  text: string;
  ts: number;
}

/**
 * The agent's reply to a synchronous send. `messageId`/`ts` are null when the
 * agent omits them — the store fills client-side fallbacks (generated id,
 * `Date.now()`) since those are time/UI concerns, not domain data.
 */
export interface IBridleReply {
  messageId: string | null;
  text: string;
  ts: number | null;
}
