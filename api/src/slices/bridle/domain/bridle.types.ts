import {
  ALLOWED_MIME_TYPES,
  BINARY_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MIME_BY_EXTENSION,
  TEXT_MIME_TYPES,
  isExtractableDocument,
} from './attachment.constants';

// ── Part types (wire protocol) ───────────────────────────────

export enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}

export interface IBridleTextPart {
  type: BridlePartTypes.Text;
  text: string;
}

export interface IBridleImagePart {
  type: BridlePartTypes.Image;
  base64: string;
  mediaType: string;
}

export interface IBridleFilePart {
  type: BridlePartTypes.File;
  url: string;
  name: string;
  mimeType?: string;
}

export type BridlePart = IBridleTextPart | IBridleImagePart | IBridleFilePart;

// ── Attachments ──────────────────────────────────────────────

/**
 * How an attachment is treated on its way to the agent. The distinction is
 * not cosmetic: the agent runtime folds `image` parts into the model call and
 * drops `file` parts before it, so only images and inlined text ever reach the
 * model. `binary` is delivered as a named reference and is labelled in the UI
 * as something the agent cannot read.
 */
export enum BridleAttachmentKinds {
  Image = 'image',
  Text = 'text',
  Binary = 'binary',
}

/** What the upload endpoint returns and what a message carries. */
export interface IBridleAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: BridleAttachmentKinds;
  /** Path of the authenticated download route — never an S3 URL. */
  url: string;
  /** False for `binary`: the agent sees the name, not the contents. */
  readableByAgent: boolean;
}

/** An attachment plus its bytes, as returned by the storage gateway. */
export interface IBridleStoredAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  body: Buffer;
  /**
   * Chat identity of whoever uploaded it (`admin`, a JWT `sub`, or
   * `share-<visitorId>`). Absent on objects stored before share links existed,
   * which is why only share visitors are owner-checked on download.
   */
  owner?: string;
}

// ── Wire protocol messages ───────────────────────────────────

/**
 * The person behind a message, separate from the conversation it belongs
 * to (CLEAN-80). `clientId` decides history and access and folds every
 * owner/admin into one shared `admin` channel on purpose; this is the JWT
 * `sub` (plus the email for display), so a runtime can keep per-person state
 * — an MCP OAuth token, say — without splitting the shared chat. Absent for
 * share visitors and anonymous embeds, whose `clientId` is already theirs
 * alone.
 */
export interface IBridleUserIdentity {
  id: string;
  email?: string;
}

/**
 * Hub → Agent control event: an MCP OAuth login finished and the token was
 * stored (CLEAN-75, CLEAN-80). `subject` names whose token it is — a user id
 * from `IBridleUserIdentity`, a share/anon client id, or the agent id for a
 * connection started on the agent's behalf — so the runtime can bring up the
 * client for exactly that person.
 */
export interface IBridleMcpConnectedEvent {
  type: 'mcp_connected';
  /** Display name of the MCP server row. */
  server: string;
  serverId: string;
  subject: string;
}

/** Hub → Agent: incoming message from a browser client */
export interface IBridleIncomingMessage {
  type: 'message';
  clientId: string;
  agentId: string;
  text: string;
  messageId: string;
  parts: BridlePart[];
  /** Who typed it, when a console login is behind the socket. */
  user?: IBridleUserIdentity;
  /** Integrator context from the embed's `data-prompt`, carried on every
   * message so the agent runtime can fold it into the system prompt. */
  prompt?: string;
  /**
   * Client capabilities advertised at handshake (`auth.capabilities` on
   * Socket.IO connect). Forwarded on every message so the agent can pick
   * which part/event types this peer renders — e.g. `thinking` events only
   * when the client can display them. Bridle SDK ≥ v0.15.0 sends
   * `['streaming', 'images', 'files', 'ui', 'thinking']`.
   */
  capabilities?: string[];
}

/**
 * What a browser is told about a message it sent, through the socket.io
 * acknowledgement (CLEAN-102). `accepted` means "handed to a connected agent",
 * not "answered": it is what lets the chat show delivered / not delivered
 * under a person's own message instead of a bubble that looks the same either
 * way. Only callers that pass an ack callback get one — the embed widget and
 * older bundles send none and behave exactly as before.
 */
export type BridleSendAck =
  | {
      status: 'accepted';
      /** The browser's own `clientMessageId` when it sent one. */
      messageId: string;
      /** Hub clock at acceptance — the time both live and replayed views show. */
      ts: number;
      /** A resend of something already handed over; not forwarded again. */
      duplicate?: true;
    }
  | {
      status: 'rejected';
      code: 'AGENT_OFFLINE' | 'ATTACHMENT_FAILED' | 'SHARE_REJECTED' | 'EMPTY';
      message?: string;
    };

/** The subset of {@link BridleSendAck} the hub itself can produce. */
export type BridleSendResult =
  | Extract<BridleSendAck, { status: 'accepted' }>
  | { status: 'rejected'; code: 'AGENT_OFFLINE' };

export interface IBridleSendOptions {
  /** Id minted by the browser; becomes the message id end to end. */
  clientMessageId?: string;
  /** The sending socket: its prompt/capabilities go to the agent, and it is
   * the one socket that does NOT get the `user_message` echo. */
  socketId?: string;
  /** The caller renders the outcome itself, so no synthetic "Agent is not
   * connected" reply is sent on its behalf. */
  withAck?: boolean;
  /** What the person typed, without the attachment blocks inlined for the
   * model — that is what the other open views should show. */
  displayText?: string;
}

/**
 * Hub → browser: a message sent from ANOTHER socket of the same conversation
 * (second tab, the admin next to the console). Without it that view would
 * show an answer to a question nobody asked there.
 */
export interface IBridleUserMessageEvent {
  type: 'user_message';
  messageId: string;
  text: string;
  attachments?: Array<
    Pick<IBridleAttachment, 'id' | 'name' | 'mimeType' | 'size' | 'kind'>
  >;
  ts: number;
  seq: number;
}

/** Agent → Hub: events routed to browser clients */
export interface IBridleOutgoingEvent {
  type:
    | 'register'
    | 'message'
    | 'stream'
    | 'stream_end'
    | 'typing'
    | 'thinking'
    | 'proposal'
    | 'proposal_update'
    | 'ping';
  clientId?: string;
  text?: string;
  parts?: BridlePart[];
  messageId?: string;
  ts?: number;
  /** `thinking` only — see IBridleThinkingEvent. Typed here so the API can
   * publish a step of its own (CLEAN-74) without casting. */
  turnId?: string;
  step?: IBridleThinkingStep;
  done?: boolean;
}

// ── Thinking (live reasoning steps) ──────────────────────────

/**
 * The structured half of a delegation step (CLEAN-74): everything the admin
 * chat needs to render "who was asked, what their card promised, why they
 * were picked, and how it went" without parsing prose. Surfaces that know
 * nothing about delegation still show the step, because `label` and `detail`
 * carry the same story in words.
 */
export interface IBridleDelegationStep {
  delegationId: string;
  /** Null when the peer is external — it has no agent id here (CLEAN-95). */
  peerAgentId: string | null;
  peerName: string;
  /** The card skills that made this peer the choice. */
  matchedSkills: { id: string; name: string }[];
  /** The calling model's one-line reason, shown to the person verbatim. */
  reason: string;
  /** The self-contained task text the peer received. */
  task: string;
  status: 'waiting' | 'answered' | 'failed' | 'rejected';
  /** Epoch ms — the client ticks its own elapsed time while waiting. */
  startedAt: number;
  durationMs?: number;
  /** Reply excerpt when answered; the cause in product wording otherwise. */
  excerpt?: string;
}

/** One published unit of agent work inside a thinking timeline. */
export interface IBridleThinkingStep {
  /** Stable per-step id — the `done` update reuses the `active` event's id. */
  id: string;
  /** Human-readable, visitor-safe step name (e.g. "Search knowledge base"). */
  label: string;
  /** Optional visitor-safe reasoning prose (markdown). Never raw tool
   * params or prompts — this event is NOT admin-gated (unlike `debug`). */
  detail?: string;
  state: 'active' | 'done';
  /**
   * Set by steps the API itself publishes rather than the runtime. Absent on
   * every step an agent emits, which is what keeps this additive.
   */
  kind?: 'delegation';
  /** Present exactly when `kind === 'delegation'`. */
  delegation?: IBridleDelegationStep;
}

/**
 * What the hub remembers about a turn in flight, so API-side code can add a
 * step to the timeline the person is already watching (CLEAN-74). The runtime
 * mints `turnId`; the hub only observes it passing through.
 */
export interface IActiveTurn {
  clientId: string;
  turnId: string;
  /** When the last step of this turn was seen — newest wins. */
  ts: number;
}

/**
 * Agent → Hub → Browser: live "what the agent is doing" feed, rendered by
 * thinking-capable clients as a collapsible timeline while the answer is
 * being prepared. Two shapes share the event: a step update (`step` set)
 * and turn completion (`done: true`, no step) which closes the open block.
 * The hub relays it to the addressed client like `stream`. Agents emit it
 * only toward clients whose handshake `capabilities` include `'thinking'`.
 */
export interface IBridleThinkingEvent {
  type: 'thinking';
  clientId: string;
  /** Groups every step of one agent turn (minted per loop run). */
  turnId: string;
  /** Present on step updates; absent on the terminal `done` event. */
  step?: IBridleThinkingStep;
  /** True on the terminal event of a turn. */
  done?: boolean;
  ts: number;
}

// ── File change proposals (CLEAN-112) ────────────────────────

/**
 * Capability a browser client declares at handshake to receive proposal
 * cards. Both consoles declare it; a surface that does not is never sent
 * `proposal` / `proposal_update`.
 */
export const PROPOSALS_CAPABILITY = 'proposals';

/**
 * API → Hub → Browser: an agent proposed a file change (through a
 * confirm-gated file tool). Sent to the active turn's client so the card lands
 * inside the conversation the person is watching; on reload the transcript
 * endpoint returns the same rows under `proposals`. The payload is the
 * proposal DTO the files API serves (see agent/file/dtos).
 */
export interface IBridleProposalEvent {
  type: 'proposal';
  clientId: string;
  turnId: string;
  ts: number;
  proposal: Record<string, unknown>;
}

/**
 * API → Hub → every browser of the chat agent: a proposal left `pending`
 * (applied / skipped / stale / refused), from whichever path acted on it.
 */
export interface IBridleProposalUpdateEvent {
  type: 'proposal_update';
  ts: number;
  proposalId: string;
  /** Target workspace — lets a client that never saw the card fetch it. */
  agentId: string;
  status: 'applied' | 'skipped' | 'stale' | 'refused';
  actedBy: string | null;
  actedVia: 'card' | 'tool' | 'editor' | null;
  actedAt: number;
  result?: unknown;
  restartRequired?: boolean;
  reason?: string | null;
}

/**
 * Agent → Hub → Admin browsers only.
 * Carries a snapshot of what was sent to the LLM and what came back, for
 * prompt debugging in the admin UI. Hub fans this out only to clients
 * with `isAdmin === true`.
 */
export interface IBridleDebugEvent {
  type: 'debug';
  clientId: string;
  messageId?: string;
  ts: number;
  model: string;
  provider: string;
  systemPrompt: string;
  history: unknown[];
  response: {
    text: string;
    toolCalls?: Array<{ name: string; params: unknown }>;
    stopReason?: string;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    credentialId?: string;
  };
  latencyMs: number;
}

/** Hub → Agent: command to push agent's local files to S3 */
export interface IBridleSyncRequest {
  type: 'sync';
  requestId: string;
}

/** Agent → Hub: ack for a sync command */
export interface IBridleSyncResponse {
  type: 'sync_done';
  requestId: string;
  pushed: number;
  error?: string;
}

// ── Health ───────────────────────────────────────────────────

/** Health check response */
export interface IBridleHealthData {
  ok: boolean;
  agentConnected: boolean;
  browserClients: number;
}

/** Per-agent health check response */
export interface IBridleAgentHealthData {
  ok: boolean;
  agentConnected: boolean;
  browserClients: number;
  agentId: string;
}

/** Registered client metadata */
export interface IBridleClientData {
  clientId: string;
  agentId: string;
  /** Owning socket/connection id — see IBridleGateway.unregisterClient. */
  socketId: string;
  send: (data: unknown) => void;
  isAdmin: boolean;
  /** Integrator context from the embed's `data-prompt` (handshake-supplied);
   * forwarded to the agent on every message in this session. */
  prompt?: string;
  /** Handshake-advertised render capabilities; attached to every message
   * forwarded to the agent (capability gate for `thinking`, `ui`, …). */
  capabilities?: string[];
  /** The console login behind this socket; attached to every message it
   * sends so the runtime can keep per-person state on a shared channel. */
  user?: IBridleUserIdentity;
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract plain text from parts array */
export function getTextFromParts(parts: BridlePart[]): string {
  return parts
    .filter((p): p is IBridleTextPart => p.type === BridlePartTypes.Text)
    .map((p) => p.text)
    .join('');
}

/** Build parts array from flat text + images (backward compat) */
export function buildParts(
  text: string,
  images?: Array<{ base64: string; mediaType: string }>,
): BridlePart[] {
  const parts: BridlePart[] = [];
  if (text) {
    parts.push({ type: BridlePartTypes.Text, text });
  }
  if (images) {
    for (const img of images) {
      parts.push({
        type: BridlePartTypes.Image,
        base64: img.base64,
        mediaType: img.mediaType,
      });
    }
  }
  return parts;
}

// ── Attachment helpers ───────────────────────────────────────

/**
 * Decide how an attachment will be treated, from its MIME type with an
 * extension fallback. Browsers report an empty `type` for .md and .csv often
 * enough that trusting the type alone would reject perfectly ordinary files.
 * Returns null for anything off the allow-list.
 */
export function resolveAttachmentKind(
  mimeType: string,
): BridleAttachmentKinds | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Image;
  }
  if ((TEXT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Text;
  }
  if ((BINARY_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Binary;
  }
  return null;
}

/**
 * Best-effort MIME type for an upload: the reported type when it is one we
 * accept, otherwise the extension's type. Deliberately conservative — we
 * never widen an unknown type into an accepted one.
 */
export function resolveAttachmentMimeType(
  reported: string | undefined,
  filename: string,
): string {
  const claimed = (reported ?? '').trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(claimed)) return claimed;

  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] ?? claimed;
}

/**
 * True when the agent can actually read the contents, not just the name.
 * Binary kind is readable when its text can be extracted server-side
 * (xlsx/xlsm, docx, pdf) — the wire kind stays `binary` because the runtime's
 * transcript sanitizer only accepts image/text/binary.
 */
export function isReadableByAgent(
  kind: BridleAttachmentKinds,
  mimeType?: string,
): boolean {
  if (kind !== BridleAttachmentKinds.Binary) return true;
  return !!mimeType && isExtractableDocument(mimeType);
}
