/**
 * The messages a person wrote while the agent could not take them (CLEAN-245).
 * Pure: the store keeps the list and sends; this says what may happen to it.
 * `admin/slices/bridle/utils/queue.ts` is its twin — the rules are the same,
 * the state each console knows is its own.
 */

import { BridleAttachmentKinds } from "../domain/bridle.types";

export const QUEUE_MAX = 3;
/** Older than this, a message is asked about before it is sent. */
export const QUEUE_STALE_MS = 24 * 60 * 60 * 1000;

/** An uploaded file: the server already holds it, the queue keeps the reference. */
export interface IQueuedAttachment {
  remoteId: string;
  name: string;
  size: number;
  kind: BridleAttachmentKinds;
  mimeType: string;
}

export interface IQueuedMessage {
  /** Client message id, minted when queued; sent as `clientMessageId`. */
  id: string;
  /** May be empty when there are attachments. */
  text: string;
  attachments: IQueuedAttachment[];
  queuedAt: number;
  /** Set when its turn came and it could not be sent; such an entry is skipped. */
  blocked?: { code: string; detail?: string };
}

/** What this console knows about the conversation at the moment of asking. */
export interface IQueueState {
  /** The socket to Ranch is up. */
  chatConnected: boolean;
  /** The agent is on the hub. */
  agentOnline: boolean;
  /**
   * What the page hosting the chat says about the agent; null when it runs,
   * and on a page that knows nothing of it (a share link).
   */
  agentState: "starting" | "failed" | "stopped" | null;
  /** The hub's word on the agent's tool servers. */
  tools: "connecting" | "limited" | null;
  /** A turn is open: the agent is still answering the last message. */
  answering: boolean;
  /** The person's request limit is waiting to reset: nothing is sent meanwhile. */
  limitWaiting: boolean;
}

export type QueueHeldReasons = "agent_failed" | "agent_stopped" | "stale";

export function canQueue(queue: IQueuedMessage[]): boolean {
  return queue.length < QUEUE_MAX;
}

/**
 * The agent can take a message now. An agent that misses a tool server
 * (`limited`) is ready: it answers with what it has.
 */
export function canTake(state: IQueueState): boolean {
  return (
    state.chatConnected &&
    state.agentOnline &&
    state.agentState === null &&
    state.tools !== "connecting" &&
    !state.answering &&
    !state.limitWaiting
  );
}

/** What a press of Send does: it never jumps what already waits. */
export function submitOutcome(
  queue: IQueuedMessage[],
  ready: boolean,
): "send" | "queue" | "full" {
  if (!canQueue(queue)) return "full";
  return ready && queue.length === 0 ? "send" : "queue";
}

/** The first entry that can still be sent. */
export function nextToSend(queue: IQueuedMessage[]): IQueuedMessage | null {
  return queue.find((entry) => !entry.blocked) ?? null;
}

/**
 * Why the queue does not drain by itself, or null when it does (or will, once
 * the agent is up). Held messages are kept and the person is asked.
 */
export function held(
  queue: IQueuedMessage[],
  state: IQueueState,
  now: number,
): QueueHeldReasons | null {
  const waiting = queue.filter((entry) => !entry.blocked);
  if (waiting.length === 0) return null;
  if (state.agentState === "failed") return "agent_failed";
  if (state.agentState === "stopped") return "agent_stopped";
  return waiting.some((entry) => now - entry.queuedAt > QUEUE_STALE_MS)
    ? "stale"
    : null;
}

/** The entry at `from` put at `to`; the same array when nothing moves. */
export function move(
  queue: IQueuedMessage[],
  from: number,
  to: number,
): IQueuedMessage[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= queue.length ||
    to >= queue.length
  )
    return queue;
  const next = queue.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

export function remove(queue: IQueuedMessage[], id: string): IQueuedMessage[] {
  return queue.some((entry) => entry.id === id)
    ? queue.filter((entry) => entry.id !== id)
    : queue;
}

/** Its turn came and it could not be sent: it stays where it is, with the reason. */
export function block(
  queue: IQueuedMessage[],
  id: string,
  blocked: { code: string; detail?: string },
): IQueuedMessage[] {
  return queue.map((entry) =>
    entry.id === id ? { ...entry, blocked } : entry,
  );
}

/** The person said "send now" to old messages: they count as written at `now`. */
export function refresh(
  queue: IQueuedMessage[],
  now: number,
): IQueuedMessage[] {
  return queue.map((entry) => ({ ...entry, queuedAt: now }));
}

const KINDS = new Set<string>(Object.values(BridleAttachmentKinds));

function parseAttachment(raw: unknown): IQueuedAttachment | null {
  const a = raw as Partial<IQueuedAttachment> | null;
  if (
    !a ||
    typeof a.remoteId !== "string" ||
    !a.remoteId ||
    typeof a.name !== "string"
  )
    return null;
  return {
    remoteId: a.remoteId,
    name: a.name,
    size: typeof a.size === "number" ? a.size : 0,
    kind: KINDS.has(a.kind as string)
      ? (a.kind as BridleAttachmentKinds)
      : BridleAttachmentKinds.Binary,
    mimeType:
      typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream",
  };
}

function parseEntry(raw: unknown): IQueuedMessage | null {
  const e = raw as Partial<IQueuedMessage> | null;
  if (!e || typeof e !== "object") return null;
  if (
    typeof e.id !== "string" ||
    !e.id ||
    typeof e.text !== "string" ||
    typeof e.queuedAt !== "number"
  )
    return null;
  const attachments = (Array.isArray(e.attachments) ? e.attachments : [])
    .map(parseAttachment)
    .filter((a): a is IQueuedAttachment => a !== null);
  const entry: IQueuedMessage = {
    id: e.id,
    text: e.text,
    attachments,
    queuedAt: e.queuedAt,
  };
  if (e.blocked && typeof e.blocked.code === "string") {
    entry.blocked = { code: e.blocked.code };
    if (typeof e.blocked.detail === "string")
      entry.blocked.detail = e.blocked.detail;
  }
  return entry;
}

/** What storage held, as a queue: anything that is not one is left out. */
export function parseQueue(raw: string | null): IQueuedMessage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseEntry)
      .filter((entry): entry is IQueuedMessage => entry !== null)
      .slice(0, QUEUE_MAX);
  } catch {
    return [];
  }
}
