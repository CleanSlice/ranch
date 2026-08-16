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

// ── Wire protocol messages ───────────────────────────────────

/** Hub → Agent: incoming message from a browser client */
export interface IBridleIncomingMessage {
  type: 'message';
  clientId: string;
  agentId: string;
  text: string;
  messageId: string;
  parts: BridlePart[];
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

/** Agent → Hub: events routed to browser clients */
export interface IBridleOutgoingEvent {
  type:
    | 'register'
    | 'message'
    | 'stream'
    | 'stream_end'
    | 'typing'
    | 'thinking'
    | 'ping';
  clientId?: string;
  text?: string;
  parts?: BridlePart[];
  messageId?: string;
  ts?: number;
}

// ── Thinking (live reasoning steps) ──────────────────────────

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
  send: (data: unknown) => void;
  isAdmin: boolean;
  /** Integrator context from the embed's `data-prompt` (handshake-supplied);
   * forwarded to the agent on every message in this session. */
  prompt?: string;
  /** Handshake-advertised render capabilities; attached to every message
   * forwarded to the agent (capability gate for `thinking`, `ui`, …). */
  capabilities?: string[];
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
