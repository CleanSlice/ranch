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

export interface IBridleMessage {
  id: string;
  role: BridleRoleTypes;
  text: string;
  ts: number;
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
  /** Where the block sits in the flow; agent-clock, bumped past the last message. */
  ts: number;
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
 */
export interface IBridleChannelAuth {
  token?: () => string | null;
  share?: IBridleShareContext;
}

/** What a live channel reports back. Every callback is optional-free on
 *  purpose: the store owns all of the state these touch. */
export interface IBridleChannelEvents {
  onConnected(): void;
  onDisconnected(): void;
  /** The hub is about to drop the socket, and says why (`TOKEN_EXPIRED`,
   *  `SHARE_LINK_INVALID`, …). */
  onRejected(code: string): void;
  /** A message the hub could not deliver; the socket stays up. */
  onMessageError(message: string): void;
  /** The agent started a turn. */
  onTyping(): void;
  onThinking(event: IBridleThinkingEvent): void;
  /** `text` is the whole answer so far, not a delta; `done` on the last frame. */
  onStream(reply: IBridleReply, done: boolean): void;
  /** A complete agent message in one piece. */
  onMessage(reply: IBridleReply): void;
}

/** A live conversation channel to one agent. */
export interface IBridleChannel {
  send(text: string, attachmentIds?: string[]): void;
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
