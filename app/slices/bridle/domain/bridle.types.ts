// Domain types for the bridle slice — the live agent chat. Envelope-free; the
// data layer maps the SDK response onto these and the store owns the reactive
// conversation state.

export enum BridleRoleTypes {
  User = 'user',
  Agent = 'agent',
}

/**
 * How an attachment reaches the agent. The distinction is visible to the
 * person: only `image` and `text` contents actually reach the model, so a
 * `binary` chip says the agent will see the file's name but not what is
 * inside it rather than letting them find out from a confused reply.
 */
export enum BridleAttachmentKinds {
  Image = 'image',
  Text = 'text',
  Binary = 'binary',
}

/** A stored attachment carried by a sent message. Metadata only, never bytes. */
export interface IBridleAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: BridleAttachmentKinds;
  /** Path on the authenticated download route — never a storage URL. */
  url: string;
  readableByAgent: boolean;
}

/** Lifecycle of a file between being picked and being sendable. */
export enum BridleAttachmentStates {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

/**
 * A file chosen but not yet sent. Lives only in the compose area — it holds a
 * `File` handle and an object URL, so it is never serialized and `previewUrl`
 * must be revoked when the draft is dropped.
 */
export interface IBridleStagedAttachment {
  /** Client-minted; identifies the chip before the server knows the file. */
  localId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  kind: BridleAttachmentKinds;
  previewUrl: string | null;
  state: BridleAttachmentStates;
  progress: number;
  /** Server id once uploaded — this is what the send call transmits. */
  remoteId: string | null;
  /** Translation key plus params, never an assembled sentence. */
  error: IBridleAttachmentError | null;
}

/**
 * Something to tell the person, kept translatable until it reaches the
 * template: a key plus named params, never an assembled sentence (docs/i18n.md).
 */
export interface IBridleNotice {
  key: string;
  params?: Record<string, string | number>;
}

/** A rejection or failure of one attachment. Same shape, named for its place. */
export type IBridleAttachmentError = IBridleNotice;

/**
 * Where one of the person's own messages stands on its way to the agent
 * (CLEAN-102). `sending` until the hub acknowledges it, `slow` once that has
 * taken long enough to say so, `failed` when the hub refused it or never
 * answered. Transitions live in `utils/delivery.ts`.
 */
export enum BridleDeliveryStates {
  Sending = 'sending',
  Slow = 'slow',
  Delivered = 'delivered',
  Failed = 'failed',
}

/**
 * The hub's answer to one `message` emit — see
 * specs/015-chat-message-reliability/contracts/bridle-socket.md. `accepted`
 * means handed to the agent's socket; `duplicate` marks a resend of an id the
 * hub had already accepted (it was not forwarded twice). `code` is one of the
 * hub's (`AGENT_OFFLINE`, `ATTACHMENT_FAILED`, `SHARE_REJECTED`, `EMPTY`) or
 * the client's own `TIMEOUT` / `OFFLINE`.
 */
export type IBridleSendAck =
  | { status: 'accepted'; messageId: string; ts: number; duplicate?: true }
  | { status: 'rejected'; code: string; message?: string };

export interface IBridleMessage {
  /**
   * The person's message: the UUID minted at send, which is also the
   * `clientMessageId` on the wire — one id end to end, so a resend is
   * recognisable. Agent message: the wire `messageId`.
   */
  id: string;
  role: BridleRoleTypes;
  text: string;
  /**
   * Display only. The person's message shows its local send time until the
   * ack brings the hub's; agent messages carry the agent's clock. Two clocks
   * — which is why nothing is ever ordered by it.
   */
  ts: number;
  /**
   * Arrival order within the conversation, assigned by the store on append.
   * The only ordering key. Optional because conversations persisted before
   * CLEAN-102 lack it — `hydrate` numbers those in stored order.
   */
  seq?: number;
  /**
   * The person's messages only. Absent means delivered: legacy and
   * echoed-from-another-view messages never had anything else to say.
   */
  delivery?: BridleDeliveryStates;
  /** Why a `failed` message failed — picks the wording under the bubble. */
  failureCode?: string;
  /**
   * Present on messages sent with attachments. Optional so conversations
   * persisted before this feature still hydrate unchanged.
   */
  attachments?: IBridleAttachment[];
  /**
   * True while the agent is still adding to this bubble. Session-only: it is
   * stripped before persisting, so a reload never shows a bubble stuck
   * "in progress" for an answer that finished long ago.
   */
  streaming?: boolean;
  /**
   * Present on the bubble that carries a file change proposal card
   * (CLEAN-112); such a bubble has no text of its own.
   */
  proposal?: IBridleProposalSnapshot;
}

// ── Thinking (live reasoning steps) ────────────────────────────
// Mirrors the wire contract in api/src/slices/bridle/domain/bridle.types.ts.

export enum BridleThinkingStepStates {
  Active = 'active',
  Done = 'done',
}

/** One published unit of agent work inside a thinking timeline. */
export interface IBridleThinkingStep {
  /** Stable per step — the `done` update reuses the `active` event's id. */
  id: string;
  /** Visitor-safe step name, e.g. "Searching the knowledge base". */
  label: string;
  /** Optional visitor-safe reasoning prose (markdown). */
  detail?: string;
  state: BridleThinkingStepStates;
}

/**
 * Hub → browser: a step update (`step` set) or the end of a turn (`done`,
 * no step). `turnId` groups every step of one agent turn.
 */
export interface IBridleThinkingEvent {
  turnId: string;
  step?: IBridleThinkingStep;
  done?: boolean;
  ts: number;
  /** Hub sequence of the frame — see `IBridleReply.seq`. */
  seq?: number;
}

export enum BridleThinkingBlockStates {
  Thinking = 'thinking',
  Done = 'done',
}

/**
 * One SEGMENT of a turn's thinking timeline. A turn may produce several: a
 * segment seals as soon as agent text lands below it, and the next step opens
 * a fresh one under that message — so the current activity always renders at
 * the bottom of the flow. Session-only, never persisted.
 */
export interface IBridleThinkingBlock {
  turnId: string;
  /** Segment ordinal within the turn — with `turnId` forms the render key. */
  seg: number;
  steps: IBridleThinkingStep[];
  state: BridleThinkingBlockStates;
  /** When the segment opened, agent-clock. Informational — never ordered by. */
  ts: number;
  /** Where the block sits in the flow: the conversation's arrival sequence. */
  seq?: number;
}

// ── Live channel ────────────────────────────────────────────────

export enum BridleChannelStates {
  Connecting = 'connecting',
  Connected = 'connected',
  Offline = 'offline',
}

/**
 * How a channel authenticates. Exactly one of the two: the console reads its
 * in-memory bearer on every (re)connect so a renewed token is what travels;
 * the share page sends the visitor's pair and NO bearer — an owner opening
 * their own link must chat as a visitor, the way the HTTP calls already do.
 *
 * `lastSeq` rides along on the same handshake and is a getter for the same
 * reason the token is: a reconnect must report the highest hub `seq` applied
 * by then, so the hub replays exactly what the gap swallowed.
 */
export interface IBridleChannelAuth {
  token?: () => string | null;
  share?: IBridleShareContext;
  lastSeq?: () => number;
}

/**
 * The hub's greeting. `clientId` is the chat identity the hub resolved for
 * this socket — and the name of the transcript channel the agent writes this
 * conversation to. `seq` is the hub's current sequence for the identity; one
 * lower than ours means the hub restarted and has nothing to replay.
 */
export interface IBridleWelcome {
  clientId: string | null;
  seq: number | null;
}

/**
 * The person's own message, echoed by the hub to their OTHER open views so a
 * second tab shows the question and not only the answer.
 */
export interface IBridleUserMessageEvent {
  messageId: string;
  text: string;
  ts: number | null;
  attachments?: IBridleAttachment[];
  seq?: number;
}

/** What a live channel reports back. Every callback is optional-free on
 *  purpose: the store owns all of the state these touch. */
export interface IBridleChannelEvents {
  onConnected(): void;
  onDisconnected(): void;
  onWelcome(welcome: IBridleWelcome): void;
  /** The hub is about to drop the socket, and says why (`TOKEN_EXPIRED`,
   *  `SHARE_LINK_INVALID`, …). */
  onRejected(code: string): void;
  /** A message the hub could not deliver; the socket stays up. */
  onMessageError(message: string, seq?: number): void;
  /** The agent started a turn. */
  onTyping(seq?: number): void;
  onThinking(event: IBridleThinkingEvent): void;
  /** `text` is the whole answer so far, not a delta; `done` on the last frame. */
  onStream(reply: IBridleReply, done: boolean): void;
  /** A complete agent message in one piece. */
  onMessage(reply: IBridleReply): void;
  /** Sent from another view of the same identity. */
  onUserMessage(message: IBridleUserMessageEvent): void;
  /** An agent proposed a file change (CLEAN-112); shown read-only here. */
  onProposal(proposal: IBridleProposalSnapshot, seq?: number): void;
  /** A proposal left `pending` — from the admin card, the editor or the agent. */
  onProposalUpdate(update: IBridleProposalUpdate, seq?: number): void;
}

// ── File change proposals (CLEAN-112) ──────────────────────────

export type BridleProposalStatus = 'pending' | 'applied' | 'skipped' | 'stale' | 'refused';

/** One row of a set (import) proposal's summary list. */
export interface IBridleProposalRow {
  path: string;
  action: 'add' | 'change' | 'unchanged' | 'remove' | 'skip';
  size: number;
}

/**
 * What the app console shows of a proposal: the card is read-only here (the
 * write tools are operator-only and the app has no Files tab), so the
 * snapshot travels inside the message and is patched by `proposal_update`.
 */
export interface IBridleProposalSnapshot {
  id: string;
  agentId: string;
  agentName: string;
  kind: 'single' | 'set';
  op: 'write' | 'create' | 'import';
  path: string | null;
  mode: 'merge' | 'replace' | null;
  proposedBytes: number;
  diffStatus: 'ok' | 'too_large' | 'binary' | 'none';
  additions: number | null;
  deletions: number | null;
  changedLines: number | null;
  firstChangedLine: number | null;
  inlineDiff: string | null;
  counts: { add: number; change: number; unchanged: number; remove: number; skip: number } | null;
  rows: IBridleProposalRow[];
  more: number;
  status: BridleProposalStatus;
  actedAt: string | null;
  reason: string | null;
  restartRequired: boolean;
  createdAt: string;
}

export interface IBridleProposalUpdate {
  proposalId: string;
  status: BridleProposalStatus;
  actedAt: number;
  reason: string | null;
  restartRequired?: boolean;
}

/** A live conversation channel to one agent. */
export interface IBridleChannel {
  /**
   * Resolves with the hub's verdict — never rejects. No answer within
   * `FAILED_MS` resolves as `rejected / TIMEOUT`. `clientMessageId` is the
   * message's own id; resending with the same one is what makes a retry safe.
   */
  send(
    text: string,
    attachmentIds: string[] | undefined,
    clientMessageId: string,
  ): Promise<IBridleSendAck>;
  /** Re-open after the hub dropped the socket — e.g. once a token was renewed. */
  reconnect(): void;
  close(): void;
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
  /**
   * The hub's per-identity sequence of the frame that carried this. Not the
   * message's place in the flow (`IBridleMessage.seq`) — it exists so a
   * replayed frame that was already applied can be told apart and dropped.
   */
  seq?: number;
}

/**
 * Credentials a public share-link visitor sends with every chat request.
 * Defined here rather than imported from the share slice so the bridle slice
 * stays independent of it — the share page builds the object, bridle only
 * carries it to the two headers the API reads.
 */
export interface IBridleShareContext {
  token: string;
  visitorId: string;
}

/**
 * Identifies one conversation. `key` — not `agentId` — is what the store and
 * localStorage are keyed by, so the owner's console chat and a visitor chat
 * for the same agent in the same browser stay separate. The console uses
 * `key === agentId`, which leaves already-persisted conversations in place.
 */
export interface IBridleConversation {
  key: string;
  agentId: string;
  /** Present only on a share-link conversation; absent in the console. */
  share?: IBridleShareContext;
}
