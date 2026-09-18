import { createServiceGetter } from '#common/composables/createServiceGetter';
import { BridleRoleTypes, BridleAttachmentStates } from '#bridle/domain';
import {
  BINARY_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  TEXT_MIME_TYPES,
  formatBytes,
  isReadableByAgent,
  resolveMimeType,
} from '#bridle/domain';
import {
  BridleAttachmentKinds,
  BridleChannelStates,
  BridleDeliveryStates,
  BridleThinkingBlockStates,
  BridleThinkingStepStates,
} from '#bridle/domain';
import type {
  BridleService,
  IBridleAttachment,
  IBridleAttachmentError,
  IBridleChannel,
  IBridleChannelEvents,
  IBridleConversation,
  IBridleMessage,
  IBridleNotice,
  IBridleReply,
  IBridleSendAck,
  IBridleStagedAttachment,
  IBridleThinkingBlock,
  IBridleThinkingEvent,
  IBridleUserMessageEvent,
  IBridleWelcome,
} from '#bridle/domain';
import { nextSeq, numberLegacy } from '#bridle/utils/chatFlow';
import {
  FAILURE_OFFLINE,
  SLOW_MS,
  nextDelivery,
  type IDeliveryEvent,
} from '#bridle/utils/delivery';
import { missedReplies } from '#bridle/utils/transcriptTail';

// Re-export the domain enums/types so consumers importing them from
// `#bridle/stores/bridle` (Message.vue) keep working. The enums are used as
// runtime values, so they're value re-exports (not `export type`).
export {
  BridleRoleTypes,
  BridleAttachmentKinds,
  BridleAttachmentStates,
  BridleChannelStates,
  BridleDeliveryStates,
  BridleThinkingBlockStates,
  BridleThinkingStepStates,
} from '#bridle/domain';
export type {
  IBridleMessage,
  IBridleReply,
  IBridleAttachment,
  IBridleAttachmentError,
  IBridleNotice,
  IBridleStagedAttachment,
  IBridleConversation,
  IBridleShareContext,
  IBridleThinkingBlock,
  IBridleThinkingStep,
} from '#bridle/domain';

const getService = createServiceGetter<BridleService>('$bridleService');

/**
 * A cancelled runtime turn never sends `stream_end`/`message` nor the
 * terminal thinking event — without this the shimmer would animate forever.
 * Re-armed by every typing/thinking/stream frame; same budget as the admin.
 */
const THINKING_STALE_MS = 75_000;

/**
 * How long a channel nobody holds stays open (CLEAN-102, research D7). Going
 * from the landing page's hero chat to the agent page unmounts one chat and
 * mounts another for the same conversation; closing at once would drop the
 * socket mid-answer, so the next holder gets a moment to take it over.
 */
const RELEASE_GRACE_MS = 3000;

/** Hub handshake rejections the console can recover from by renewing. */
const RENEWABLE_CODES = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN']);
/** Hub rejections that mean the share link itself is dead. */
const SHARE_DEAD_CODES = new Set(['SHARE_LINK_INVALID', 'SHARE_VISITOR_INVALID']);

// localStorage persistence for chat conversations — survives page refresh.
// Scoped per conversation key so switching agents doesn't bleed history, and
// so a share-link visitor's chat never lands in the owner's console history
// for the same agent. In the console `key === agentId`, which is what the
// pre-descriptor version wrote — already-stored conversations still load.
// Mirrors the admin's per-bot persistence pattern for debug snapshots.
const CONVERSATION_STORAGE_PREFIX = 'bridle:conversation:';
/**
 * The highest hub `seq` applied to a conversation, kept next to it so a reload
 * can ask the hub for what arrived while the page was gone. A key of its own:
 * the conversation entry is a bare message array that older builds still read.
 */
const HUB_SEQ_STORAGE_PREFIX = 'bridle:seq:';

/**
 * Sent with attachments when the person typed nothing. The shared
 * SendMessageDto keeps `text` as @IsNotEmpty() because the embed widget and
 * the admin chat post to the same endpoint — relaxing it there to satisfy a
 * console-only case would change validation for every caller.
 */
const EMPTY_TEXT_PLACEHOLDER = ' ';

function loadConversationFromStorage(key: string): IBridleMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IBridleMessage[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[bridle] failed to load persisted conversation', err);
    return null;
  }
}

function saveConversationToStorage(
  key: string,
  messages: IBridleMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CONVERSATION_STORAGE_PREFIX + key,
      JSON.stringify(messages),
    );
  } catch (err) {
    // Quota exceeded or storage disabled — best-effort, ignore.
    console.warn('[bridle] failed to persist conversation', err);
  }
}

function clearConversationFromStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}

function loadHubSeqFromStorage(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const seq = Number(window.localStorage.getItem(HUB_SEQ_STORAGE_PREFIX + key));
    return Number.isFinite(seq) && seq > 0 ? seq : 0;
  } catch {
    return 0;
  }
}

function saveHubSeqToStorage(key: string, seq: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HUB_SEQ_STORAGE_PREFIX + key, String(seq));
  } catch {
    // Best-effort: a lost value only means the hub replays a little more.
  }
}

/**
 * The message id, which is also the `clientMessageId` on the wire.
 * `randomUUID` exists only in a secure context; a console served over plain
 * http on a LAN must still be able to send, so it falls back to an id that is
 * merely unique enough for the hub's ten-minute idempotency window.
 */
function newMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The message after a delivery event. The old state is dropped before the new
 * one is spread in, so a `failureCode` never outlives the failure it explained.
 */
function withDelivery(
  message: IBridleMessage,
  event: IDeliveryEvent,
): IBridleMessage {
  const { delivery: _d, failureCode: _f, ...rest } = message;
  return { ...rest, ...nextDelivery(message, event) };
}

/** One live channel and how many mounted chats are holding it open. */
interface IChannelHold {
  channel: IBridleChannel | null;
  holders: number;
  closeTimer?: ReturnType<typeof setTimeout>;
}

function resolveKind(mimeType: string): BridleAttachmentKinds | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Image;
  }
  if ((TEXT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Text;
  }
  return BridleAttachmentKinds.Binary;
}

export const useBridleStore = defineStore('bridle', () => {
  const conversations = ref<Record<string, IBridleMessage[]>>({});
  /**
   * True from the moment a message is sent until the agent's first visible
   * content lands (or the turn dies). Drives the shimmer status line when no
   * thinking block is open. It does NOT gate the composer: a follow-up while
   * the agent is still answering is a normal thing to send (CLEAN-102).
   */
  const pending = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, IBridleNotice | null>>({});
  /** Conversations already pulled from localStorage. */
  const hydrated = ref<Record<string, boolean>>({});
  /** Live channel state per conversation — what "Reconnecting…" reads. */
  const connection = ref<Record<string, BridleChannelStates>>({});
  /**
   * Live thinking timelines, one per agent turn segment — opened by the
   * first `thinking` step, frozen by the turn's terminal event (or when the
   * socket drops / the stale watchdog fires). Session-only.
   */
  const thinking = ref<Record<string, IBridleThinkingBlock[]>>({});
  /**
   * Set when the hub rejected a share visitor's socket because the link is
   * dead. The share page watches it the way it watches a 403 on the HTTP
   * calls: the verdict is final and turns the page into its revoked state.
   */
  const shareRevoked = ref<Record<string, boolean>>({});

  // Plain maps, not refs: sockets and timers are not view state, and a
  // reactive proxy around a socket.io client would only get in the way.
  /**
   * One channel per conversation, shared by every chat that shows it. The
   * landing hero and the agent page mount the SAME conversation, and during a
   * route change both exist at once — so a channel is held, not owned:
   * `channel` is null while the handshake prerequisites are still in flight,
   * `closeTimer` runs while nobody holds it (see RELEASE_GRACE_MS).
   */
  const channels = new Map<string, IChannelHold>();
  const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  /** Next arrival `seq` per conversation — the flow's only ordering key. */
  const nextSeqs = new Map<string, number>();
  /** Highest hub `seq` applied per conversation; what a reconnect reports. */
  const lastHubSeqs = new Map<string, number>();
  /**
   * The chat identity the hub resolved for this conversation (`welcome`). It
   * is also the transcript channel the agent writes to — `admin` for owners
   * and admins, the user id otherwise, `share-<visitorId>` for a visitor — and
   * the hub is the only side that knows which.
   */
  const hubClientIds = new Map<string, string>();
  /** "Still sending…" timers, keyed by message id. */
  const slowTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Turns whose terminal event arrived; straggler steps are ignored. */
  const closedTurns = new Map<string, Set<string>>();
  /** One renew-and-reconnect per rejection, never a loop. */
  const authRetried = new Set<string>();
  /** Files picked but not yet sent, keyed by conversation like everything here. */
  const staged = ref<Record<string, IBridleStagedAttachment[]>>({});
  /** Last rejection, surfaced once and then dismissed by the next action. */
  const attachmentErrors = ref<Record<string, IBridleAttachmentError | null>>({});
  /**
   * Text of a message the console could not send because the session ended
   * mid-flight (CLEAN-72). The composer picks it up again so the person can
   * resend after signing in; consumed once, never persisted.
   */
  const drafts = ref<Record<string, string>>({});

  // Read side takes the bare `key` — a template already holds the descriptor
  // and passing the whole object just to look up an array buys nothing.
  const messagesFor = (key: string) => conversations.value[key] ?? [];
  const isPending = (key: string) => pending.value[key] === true;
  const errorFor = (key: string) => errors.value[key] ?? null;
  const connectionFor = (key: string) =>
    connection.value[key] ?? BridleChannelStates.Offline;
  const thinkingFor = (key: string) => thinking.value[key] ?? [];
  const isShareRevoked = (key: string) => shareRevoked.value[key] === true;
  const hasOpenThinking = (key: string) =>
    thinkingFor(key).some((b) => b.state === BridleThinkingBlockStates.Thinking);
  const stagedFor = (key: string) => staged.value[key] ?? [];
  const attachmentErrorFor = (key: string) => attachmentErrors.value[key] ?? null;
  const draftFor = (key: string) => drafts.value[key] ?? '';

  function clearDraft(key: string) {
    delete drafts.value[key];
  }

  const isUploading = (key: string) =>
    stagedFor(key).some((a) => a.state === BridleAttachmentStates.Uploading);
  const hasFailedAttachment = (key: string) =>
    stagedFor(key).some((a) => a.state === BridleAttachmentStates.Failed);

  /**
   * Sending is allowed with text OR at least one ready attachment, and is
   * blocked while anything is still uploading or has failed — an incomplete
   * message would reach the agent missing exactly the file it was about.
   * A turn in progress is no reason to wait: the follow-up is queued behind
   * it by the agent, not by the composer.
   */
  function canSend(key: string, draft: string): boolean {
    if (isUploading(key) || hasFailedAttachment(key)) return false;
    const hasReady = stagedFor(key).some(
      (a) => a.state === BridleAttachmentStates.Ready,
    );
    return draft.trim().length > 0 || hasReady;
  }

  /**
   * Replay persisted messages for the given conversation from localStorage.
   * Idempotent — called from the Provider on mount so the chat survives a page
   * refresh. Avoids overwriting an existing in-memory conversation (e.g. if the
   * user navigated away and back without reloading).
   */
  function hydrate(conv: IBridleConversation) {
    const key = conv.key;
    if (hydrated.value[key]) return;
    hydrated.value[key] = true;
    if (conversations.value[key]?.length) return;
    const stored = loadConversationFromStorage(key);
    if (stored && stored.length) {
      // Belt and braces: `persist` strips the flag, but a bubble that was
      // stored mid-stream by an older build must not reload as "in progress".
      // Conversations stored before CLEAN-102 carry no `seq`: number them in
      // stored order, which is the order the person saw them arrive in.
      conversations.value[key] = numberLegacy(
        stored.map(({ streaming: _s, ...m }) => m),
      ).map((m) =>
        // A message that was still on its way when the page went away: its
        // ack was owed to a socket that no longer exists. Say so, and let the
        // person decide — resending is safe, the id is the same.
        m.role === BridleRoleTypes.User && m.delivery
          ? withDelivery(m, { type: 'pageLoad' })
          : m,
      );
      nextSeqs.set(key, nextSeq(conversations.value[key]));
      persist(conv);
    }
  }

  /** Hand out the next arrival number — messages and thinking blocks alike. */
  function takeSeq(key: string): number {
    const seq =
      nextSeqs.get(key) ?? nextSeq([...messagesFor(key), ...thinkingFor(key)]);
    nextSeqs.set(key, seq + 1);
    return seq;
  }

  function persist(conv: IBridleConversation) {
    const messages = conversations.value[conv.key];
    if (messages && messages.length) {
      saveConversationToStorage(
        conv.key,
        messages.map(({ streaming: _s, ...m }) => m),
      );
    } else {
      clearConversationFromStorage(conv.key);
    }
  }

  /**
   * Every message enters the conversation here or in `onStream`, and both
   * stamp it with the next arrival `seq`: the order things reached THIS
   * screen is the order the person experienced, whatever the clocks say.
   */
  function appendMessage(conv: IBridleConversation, message: IBridleMessage) {
    if (!conversations.value[conv.key]) conversations.value[conv.key] = [];
    conversations.value[conv.key].push({ ...message, seq: takeSeq(conv.key) });
    persist(conv);
  }

  function findMessage(key: string, id: string): IBridleMessage | undefined {
    return conversations.value[key]?.find((m) => m.id === id);
  }

  /** Replace one message in place — the list keeps its order and its `seq`s. */
  function replaceMessage(conv: IBridleConversation, next: IBridleMessage) {
    const list = conversations.value[conv.key];
    const index = list?.findIndex((m) => m.id === next.id) ?? -1;
    if (!list || index === -1) return;
    list[index] = next;
    persist(conv);
  }

  // ── Hub sequence ───────────────────────────────────────────

  /** Highest hub `seq` applied, read back from storage on first use. */
  function lastHubSeq(key: string): number {
    let seq = lastHubSeqs.get(key);
    if (seq === undefined) {
      seq = loadHubSeqFromStorage(key);
      lastHubSeqs.set(key, seq);
    }
    return seq;
  }

  /**
   * Gate for every hub frame. A frame at or below the highest `seq` already
   * applied is a replay overlap and is dropped; a frame without a `seq` comes
   * from a hub that predates sequencing and is always live. `save: false` is
   * for stream chunks: the final frame saves, and a value that lags only
   * makes the hub replay a few frames that are dropped here again.
   */
  function acceptSeq(key: string, seq: number | undefined, save = true) {
    if (seq === undefined) return true;
    if (seq <= lastHubSeq(key)) return false;
    lastHubSeqs.set(key, seq);
    if (save) saveHubSeqToStorage(key, seq);
    return true;
  }

  // ── Attachments ────────────────────────────────────────────

  /**
   * Validate a picked file against the client mirror of the API's limits.
   * Returns a translation key rather than a sentence — copy assembled in
   * script is invisible to the i18n extraction sweep.
   */
  function validate(
    key: string,
    file: File,
    pendingBytes: number,
  ): IBridleAttachmentError | null {
    if (stagedFor(key).length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return {
        key: 'chat.attach_limit',
        params: { count: MAX_ATTACHMENTS_PER_MESSAGE },
      };
    }
    if (file.size === 0) {
      return { key: 'chat.error_empty', params: { name: file.name } };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        key: 'chat.error_size',
        params: { name: file.name, limit: formatBytes(MAX_ATTACHMENT_BYTES) },
      };
    }
    if (pendingBytes + file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
      return {
        key: 'chat.error_total',
        params: { limit: formatBytes(MAX_MESSAGE_ATTACHMENT_BYTES) },
      };
    }
    return null;
  }

  /**
   * Stage a selection. A rejected file never blocks the acceptable ones
   * alongside it — picking five files where one is a .zip stages four.
   */
  function stageFiles(conv: IBridleConversation, files: File[] | FileList) {
    const key = conv.key;
    const list = Array.from(files);
    if (!list.length) return;
    if (!staged.value[key]) staged.value[key] = [];
    attachmentErrors.value[key] = null;

    let pendingBytes = stagedFor(key).reduce((sum, a) => sum + a.size, 0);

    for (const file of list) {
      const mimeType = resolveMimeType(file);
      const allowed = ALLOWED_SET.has(mimeType);
      const problem = !allowed
        ? { key: 'chat.error_type', params: { name: file.name } }
        : validate(key, file, pendingBytes);

      if (problem) {
        attachmentErrors.value[key] = problem;
        continue;
      }

      const kind = resolveKind(mimeType) ?? BridleAttachmentKinds.Binary;
      const staging: IBridleStagedAttachment = {
        localId: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        mimeType,
        kind,
        previewUrl:
          kind === BridleAttachmentKinds.Image ? URL.createObjectURL(file) : null,
        state: BridleAttachmentStates.Uploading,
        progress: 0,
        remoteId: null,
        error: null,
      };

      staged.value[key].push(staging);
      pendingBytes += file.size;
      void upload(conv, staging.localId);
    }
  }

  function findStaged(
    key: string,
    localId: string,
  ): IBridleStagedAttachment | undefined {
    return staged.value[key]?.find((a) => a.localId === localId);
  }

  async function upload(conv: IBridleConversation, localId: string) {
    const key = conv.key;
    const entry = findStaged(key, localId);
    if (!entry) return;

    entry.state = BridleAttachmentStates.Uploading;
    entry.progress = 0;
    entry.error = null;

    try {
      const stored = await getService().uploadAttachment(
        conv.agentId,
        entry.file,
        (percent) => {
          // The chip may have been removed mid-flight.
          const live = findStaged(key, localId);
          if (live) live.progress = percent;
        },
        conv.share,
      );
      const live = findStaged(key, localId);
      if (!live) return;
      live.remoteId = stored.id;
      live.kind = stored.kind;
      live.mimeType = stored.mimeType;
      live.progress = 100;
      live.state = BridleAttachmentStates.Ready;
    } catch (err) {
      const live = findStaged(key, localId);
      if (!live) return;
      // Failure is recorded against this file only. The draft text and every
      // other staged file are untouched — losing a written message because one
      // upload broke is the worst outcome here.
      live.state = BridleAttachmentStates.Failed;
      live.error = {
        key: 'chat.attachment_failed',
        params: { name: live.name },
      };
      console.warn('[bridle] attachment upload failed', err);
    }
  }

  function retryStaged(conv: IBridleConversation, localId: string) {
    const entry = findStaged(conv.key, localId);
    if (!entry || entry.state === BridleAttachmentStates.Uploading) return;
    void upload(conv, localId);
  }

  function revoke(entry: IBridleStagedAttachment) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }

  function removeStaged(conv: IBridleConversation, localId: string) {
    const list = staged.value[conv.key];
    if (!list) return;
    const index = list.findIndex((a) => a.localId === localId);
    if (index < 0) return;
    revoke(list[index]);
    list.splice(index, 1);
    attachmentErrors.value[conv.key] = null;
  }

  function clearStaged(conv: IBridleConversation) {
    for (const entry of staged.value[conv.key] ?? []) revoke(entry);
    staged.value[conv.key] = [];
    attachmentErrors.value[conv.key] = null;
  }

  function dismissAttachmentError(conv: IBridleConversation) {
    attachmentErrors.value[conv.key] = null;
  }

  /**
   * Read a sent attachment back so the transcript can show it. Not cached
   * here: the caller turns the blob into an object URL and owns revoking it,
   * and a cache in the store would keep every image of every conversation
   * alive for the life of the tab.
   */
  function fetchAttachment(conv: IBridleConversation, attachmentId: string) {
    return getService().fetchAttachment(conv.agentId, attachmentId, conv.share);
  }

  // ── Live channel ───────────────────────────────────────────

  function armWatchdog(conv: IBridleConversation) {
    const key = conv.key;
    const current = watchdogs.get(key);
    if (current) clearTimeout(current);
    watchdogs.set(
      key,
      setTimeout(() => {
        watchdogs.delete(key);
        void onTurnStale(conv);
      }, THINKING_STALE_MS),
    );
  }

  /**
   * The watchdog's verdict. It also fires, harmlessly, a while after every
   * turn that ended well — nothing disarms it on the last frame — so the
   * safety net is reserved for a turn that was still visibly open: the agent
   * may well have answered (its log says so) while the frames never reached
   * this browser. Ask the transcript before telling the person it went wrong.
   */
  async function onTurnStale(conv: IBridleConversation) {
    const key = conv.key;
    const open = isPending(key) || hasOpenThinking(key);
    pending.value[key] = false;
    closeAllTurns(key);
    if (!open) return;
    if (!(await recoverFromTranscript(conv))) {
      errors.value[key] = { key: 'chat.error_turn_unfinished' };
    }
  }

  /**
   * Append the agent messages the transcript holds and the screen does not.
   * Returns whether anything was recovered. A failed read is "nothing
   * recovered", never an error of its own — this is the fallback already.
   */
  async function recoverFromTranscript(conv: IBridleConversation) {
    const key = conv.key;
    const channel = hubClientIds.get(key);
    if (!channel) return false;
    let tail: IBridleMessage[];
    try {
      tail = await getService().transcriptTail(conv.agentId, channel, conv.share);
    } catch (err) {
      console.warn('[bridle] transcript read failed', err);
      return false;
    }
    // Measured against the screen as it is NOW: the answer may have arrived
    // over the socket while the request was in flight.
    const missed = missedReplies(messagesFor(key), tail);
    for (const m of missed) {
      appendMessage(conv, {
        id: m.id,
        role: BridleRoleTypes.Agent,
        text: m.text,
        ts: m.ts,
      });
    }
    return missed.length > 0;
  }

  function disarmWatchdog(key: string) {
    const current = watchdogs.get(key);
    if (current) clearTimeout(current);
    watchdogs.delete(key);
  }

  function freezeBlock(block: IBridleThinkingBlock) {
    block.state = BridleThinkingBlockStates.Done;
    block.steps = block.steps.map((s) => ({
      ...s,
      state: BridleThinkingStepStates.Done,
    }));
  }

  /**
   * Seal (collapse) every open segment. The turns stay open — later steps of
   * the same turn open a fresh segment below the newest message.
   */
  function freezeOpenThinking(key: string) {
    for (const b of thinkingFor(key)) {
      if (b.state === BridleThinkingBlockStates.Thinking) freezeBlock(b);
    }
  }

  /** Terminal paths (watchdog, hub rejection, the channel closing): seal
   *  segments AND close their turns so a straggler step cannot resurrect a
   *  zombie segment. A socket that merely dropped is NOT one of them. */
  function closeAllTurns(key: string) {
    const closed = closedTurns.get(key) ?? new Set<string>();
    for (const b of thinkingFor(key)) closed.add(b.turnId);
    closedTurns.set(key, closed);
    freezeOpenThinking(key);
    disarmWatchdog(key);
  }

  function onThinking(conv: IBridleConversation, e: IBridleThinkingEvent) {
    const key = conv.key;
    if (!acceptSeq(key, e.seq)) return;
    if (!thinking.value[key]) thinking.value[key] = [];
    const blocks = thinking.value[key];
    const closed = closedTurns.get(key) ?? new Set<string>();
    closedTurns.set(key, closed);
    const turnBlocks = blocks.filter((b) => b.turnId === e.turnId);

    if (e.done || !e.step) {
      // Terminal event — freeze every segment and refuse stragglers.
      for (const b of turnBlocks) freezeBlock(b);
      closed.add(e.turnId);
      return;
    }
    if (closed.has(e.turnId)) return;

    // `done` updates land in whichever segment holds the step id — the
    // segment may have sealed while the tool was still running.
    const step = e.step;
    const owner = turnBlocks.find((b) => b.steps.some((s) => s.id === step.id));
    if (owner) {
      owner.steps = owner.steps.map((s) => (s.id === step.id ? step : s));
      pending.value[key] = true;
      armWatchdog(conv);
      return;
    }

    // New step: continue the trailing open segment, or open a fresh one
    // below the newest message (segments seal when content lands).
    let block = turnBlocks[turnBlocks.length - 1];
    if (!block || block.state === BridleThinkingBlockStates.Done) {
      // Linear conversation: a new turn's first step closes other turns.
      for (const b of blocks) {
        if (
          b.turnId !== e.turnId &&
          b.state === BridleThinkingBlockStates.Thinking
        ) {
          freezeBlock(b);
          closed.add(b.turnId);
        }
      }
      // Anchored by arrival, like a message: below everything on screen
      // now, above whatever lands next. `ts` is the agent's clock and says
      // nothing about where the block belongs.
      block = {
        turnId: e.turnId,
        seg: turnBlocks.length,
        steps: [],
        state: BridleThinkingBlockStates.Thinking,
        ts: e.ts,
        seq: takeSeq(key),
      };
      blocks.push(block);
    }
    block.steps.push(step);
    // Steps mean the agent is working — keep the shimmer alive through tool
    // execution and re-arm the watchdog.
    pending.value[key] = true;
    armWatchdog(conv);
  }

  function onStream(
    conv: IBridleConversation,
    reply: IBridleReply,
    done: boolean,
  ) {
    const key = conv.key;
    if (!acceptSeq(key, reply.seq, done)) return;
    // Streaming is activity too — keep the stale watchdog fed so an open
    // block only freezes when the turn truly went silent.
    if (!done && hasOpenThinking(key)) armWatchdog(conv);
    const list = conversations.value[key] ?? (conversations.value[key] = []);
    const index = reply.messageId
      ? list.findIndex((m) => m.id === reply.messageId)
      : -1;
    if (index !== -1) {
      const current = list[index];
      list[index] = { ...current, text: reply.text, streaming: !done };
    } else {
      // No bubble for an empty first chunk — wait until the runtime actually
      // has visible content.
      if (!reply.text.trim()) {
        if (done) pending.value[key] = false;
        return;
      }
      // First visible chunk of a new bubble — seal the open segment so
      // subsequent steps continue below this message.
      freezeOpenThinking(key);
      list.push({
        id: reply.messageId || `a-${Date.now()}`,
        role: BridleRoleTypes.Agent,
        text: reply.text,
        ts: reply.ts ?? Date.now(),
        seq: takeSeq(key),
        ...(done ? {} : { streaming: true }),
      });
    }
    // Content is on screen: the composer opens up again.
    pending.value[key] = false;
    // Persisting per chunk would hammer localStorage for nothing — the final
    // frame carries the whole text.
    if (done) persist(conv);
  }

  function onMessage(conv: IBridleConversation, reply: IBridleReply) {
    const key = conv.key;
    if (!acceptSeq(key, reply.seq)) return;
    pending.value[key] = false;
    if (!reply.text.trim()) return;
    // A message already on screen — replayed after a reload that lost the
    // hub sequence, say — updates its bubble and never adds a second one.
    const existing = reply.messageId ? findMessage(key, reply.messageId) : null;
    if (existing) {
      replaceMessage(conv, { ...existing, text: reply.text });
      return;
    }
    // Content lands below the open segment — seal it so the next step opens
    // a fresh segment under this message (turn stays open).
    freezeOpenThinking(key);
    appendMessage(conv, {
      id: reply.messageId || `a-${Date.now()}`,
      role: BridleRoleTypes.Agent,
      text: reply.text,
      ts: reply.ts ?? Date.now(),
    });
  }

  async function onRejected(conv: IBridleConversation, code: string) {
    const key = conv.key;
    pending.value[key] = false;
    closeAllTurns(key);

    if (conv.share) {
      if (SHARE_DEAD_CODES.has(code)) {
        shareRevoked.value[key] = true;
        return;
      }
      errors.value[key] = { key: 'chat.error_rejected', params: { code } };
      return;
    }

    if (RENEWABLE_CODES.has(code)) {
      // One refresh + reconnect covers a token that expired while the tab was
      // asleep; if the session itself is gone, say so — the session-ended
      // dialog replaces the "Reconnecting…" limbo (CLEAN-72).
      const auth = useAuthStore();
      if (!authRetried.has(key) && (await auth.refresh())) {
        authRetried.add(key);
        channels.get(key)?.channel?.reconnect();
      } else {
        handBackUnsent(conv);
        auth.endSession(code);
      }
      return;
    }
    errors.value[key] = { key: 'chat.error_rejected', params: { code } };
  }

  /**
   * The session ended under a message that never left (CLEAN-72): put its
   * text back in the composer, so signing in again leads straight to sending
   * it. This is the ONE path that still hands text back — everywhere else an
   * unsent message stays in the conversation as "not delivered", which
   * survives a reload and cannot be retyped into a duplicate. Moved, not
   * copied, for the same reason. A message with files stays where it is: the
   * composer can take the words back, not the uploads.
   */
  function handBackUnsent(conv: IBridleConversation) {
    const key = conv.key;
    const list = messagesFor(key);
    const last = list[list.length - 1];
    if (!last || last.role !== BridleRoleTypes.User) return;
    const unsent =
      last.delivery === BridleDeliveryStates.Sending ||
      last.delivery === BridleDeliveryStates.Slow ||
      (last.delivery === BridleDeliveryStates.Failed &&
        last.failureCode === FAILURE_OFFLINE);
    if (!unsent || !last.text || last.attachments?.length) return;
    drafts.value[key] = last.text;
    removeMessage(conv, last.id);
  }

  /** Every frame of one channel lands here, gated by `acceptSeq`. */
  function channelEvents(conv: IBridleConversation): IBridleChannelEvents {
    const key = conv.key;
    return {
      onConnected() {
        connection.value[key] = BridleChannelStates.Connected;
        authRetried.delete(key);
      },
      onDisconnected() {
        // Only the badge changes. A dropped socket reconnects on its own and
        // the hub replays what the gap swallowed (`lastSeq`), so the turn is
        // left open: if it really died, the watchdog says so — after asking
        // the transcript (CLEAN-102, research F4).
        connection.value[key] = BridleChannelStates.Offline;
      },
      onWelcome: (welcome) => onWelcome(conv, welcome),
      onRejected: (code) => void onRejected(conv, code),
      onMessageError(message, seq) {
        if (!acceptSeq(key, seq)) return;
        pending.value[key] = false;
        errors.value[key] = {
          key: 'chat.error_message',
          params: { message },
        };
      },
      onTyping(seq) {
        if (!acceptSeq(key, seq)) return;
        pending.value[key] = true;
        armWatchdog(conv);
      },
      onThinking: (e) => onThinking(conv, e),
      onStream: (reply, done) => onStream(conv, reply, done),
      onMessage: (reply) => onMessage(conv, reply),
      onUserMessage: (message) => onUserMessage(conv, message),
    };
  }

  function onWelcome(conv: IBridleConversation, welcome: IBridleWelcome) {
    const key = conv.key;
    if (welcome.clientId) hubClientIds.set(key, welcome.clientId);
    if (welcome.seq === null || welcome.seq >= lastHubSeq(key)) return;
    // The hub counts from below what we have applied: it restarted and its
    // replay buffer went with it. Adopt its numbering — or every frame from
    // now on would look stale — and ask the transcript for the answer a
    // replay can no longer bring. Only when one is owed: the last word on
    // screen is the person's, or a turn is visibly open.
    lastHubSeqs.set(key, welcome.seq);
    saveHubSeqToStorage(key, welcome.seq);
    const list = messagesFor(key);
    const last = list[list.length - 1];
    const owed =
      isPending(key) ||
      hasOpenThinking(key) ||
      (last?.role === BridleRoleTypes.User &&
        last.delivery !== BridleDeliveryStates.Failed);
    if (owed) void recoverFromTranscript(conv);
  }

  /**
   * The person's own message, sent from another tab or device. Shown as
   * delivered — the hub only echoes what it accepted — unless this view is
   * the one that sent it, which the id tells.
   */
  function onUserMessage(
    conv: IBridleConversation,
    e: IBridleUserMessageEvent,
  ) {
    const key = conv.key;
    if (!acceptSeq(key, e.seq)) return;
    if (findMessage(key, e.messageId)) return;
    const attachments = e.attachments?.map((a) => ({
      ...a,
      url:
        a.url ||
        `/api/agent/${encodeURIComponent(conv.agentId)}/attachment/${a.id}`,
    }));
    appendMessage(conv, {
      id: e.messageId,
      role: BridleRoleTypes.User,
      text: e.text.trim(),
      ts: e.ts ?? Date.now(),
      ...(attachments?.length ? { attachments } : {}),
    });
  }

  /**
   * Hold the live channel for a conversation, opening it for the first
   * holder. Every chat showing the conversation holds it for as long as it is
   * mounted, so one unmounting cannot pull the socket from under another
   * (CLEAN-102, research F5). The console makes sure its bearer is not about
   * to expire first: the hub would refuse it a moment later.
   */
  async function acquire(conv: IBridleConversation) {
    const key = conv.key;
    const held = channels.get(key);
    if (held) {
      held.holders++;
      if (held.closeTimer) clearTimeout(held.closeTimer);
      held.closeTimer = undefined;
      return;
    }

    // Registered before the first await, so a second holder arriving while
    // the token is being checked joins this hold instead of opening a socket
    // of its own.
    const hold: IChannelHold = { channel: null, holders: 1 };
    channels.set(key, hold);
    connection.value[key] = BridleChannelStates.Connecting;
    if (!conv.share) await useAuthStore().ensureFresh();
    // Released and closed while that was in flight.
    if (channels.get(key) !== hold) return;

    hold.channel = getService().openChannel(
      conv.agentId,
      {
        ...(conv.share
          ? { share: conv.share }
          : { token: () => useAuthStore().accessToken }),
        lastSeq: () => lastHubSeq(key),
      },
      channelEvents(conv),
    );
  }

  /**
   * Let go of the channel. With holders left, nothing at all changes — not
   * the connection state, not `pending`, not the thinking blocks: the
   * conversation is still on someone's screen. The last release closes the
   * socket after a grace delay, so a page-to-page handoff whose unmount runs
   * before the next mount still reuses it. Messages stay either way: they are
   * persisted, the socket is not.
   */
  function release(conv: IBridleConversation) {
    const key = conv.key;
    const held = channels.get(key);
    if (!held) return;
    held.holders = Math.max(0, held.holders - 1);
    if (held.holders > 0 || held.closeTimer) return;
    held.closeTimer = setTimeout(() => {
      if (channels.get(key) !== held || held.holders > 0) return;
      held.channel?.close();
      channels.delete(key);
      connection.value[key] = BridleChannelStates.Offline;
      pending.value[key] = false;
      closeAllTurns(key);
    }, RELEASE_GRACE_MS);
  }

  // ── Sending ────────────────────────────────────────────────

  function sendMessage(conv: IBridleConversation, text: string) {
    const key = conv.key;
    const trimmed = text.trim();
    const ready = stagedFor(key).filter(
      (a) => a.state === BridleAttachmentStates.Ready && a.remoteId,
    );

    if (!trimmed && !ready.length) return;
    // Refuse rather than silently dropping the file the message is about.
    if (isUploading(key) || hasFailedAttachment(key)) return;

    const attachments: IBridleAttachment[] = ready.map((a) => ({
      id: a.remoteId as string,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind,
      url: `/api/agent/${encodeURIComponent(conv.agentId)}/attachment/${a.remoteId}`,
      readableByAgent: isReadableByAgent(a.kind, a.mimeType),
    }));

    const message: IBridleMessage = {
      id: newMessageId(),
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    };
    // In the conversation — and so in localStorage — before anything can
    // fail: what the person sent is never silently gone, only ever visibly
    // not delivered.
    appendMessage(conv, withDelivery(message, { type: 'sent' }));

    // Clear the compose area before the round trip so the person can start
    // typing the next message while the agent thinks.
    clearStaged(conv);
    errors.value[key] = null;
    transmit(conv, message.id);
  }

  /**
   * Put one `sending` message on the wire and see it through to a verdict.
   * Shared by the first send and by `resend`, which is why it takes the id:
   * the wire `clientMessageId` IS the message id, so the hub recognises a
   * repeat and answers `duplicate` instead of handing it to the agent twice.
   */
  function transmit(conv: IBridleConversation, id: string) {
    const key = conv.key;
    const message = findMessage(key, id);
    if (!message) return;

    const channel = channels.get(key)?.channel;
    if (!channel || connectionFor(key) !== BridleChannelStates.Connected) {
      // Never emit into a socket that is not there: socket.io would buffer
      // it, and the bubble would claim a send that is not happening.
      settle(conv, id, { type: 'ackRejected', code: FAILURE_OFFLINE });
      return;
    }

    pending.value[key] = true;
    armWatchdog(conv);
    slowTimers.set(
      id,
      setTimeout(() => {
        slowTimers.delete(id);
        applyDelivery(conv, id, { type: 'tick', elapsedMs: SLOW_MS });
      }, SLOW_MS),
    );

    void channel
      .send(
        message.text || EMPTY_TEXT_PLACEHOLDER,
        message.attachments?.length
          ? message.attachments.map((a) => a.id)
          : undefined,
        id,
      )
      .then((ack) => onAck(conv, id, ack));
  }

  function applyDelivery(
    conv: IBridleConversation,
    id: string,
    event: IDeliveryEvent,
    patch: Partial<IBridleMessage> = {},
  ) {
    const message = findMessage(conv.key, id);
    // Discarded, or the conversation was reset, while the ack was on its way.
    if (!message) return;
    replaceMessage(conv, { ...withDelivery(message, event), ...patch });
  }

  /** A verdict is in: stop the "still sending" timer and record it. */
  function settle(
    conv: IBridleConversation,
    id: string,
    event: IDeliveryEvent,
    patch: Partial<IBridleMessage> = {},
  ) {
    const timer = slowTimers.get(id);
    if (timer) clearTimeout(timer);
    slowTimers.delete(id);
    applyDelivery(conv, id, event, patch);
  }

  function onAck(conv: IBridleConversation, id: string, ack: IBridleSendAck) {
    const key = conv.key;
    if (ack.status === 'accepted') {
      // The hub's clock from here on, so the time under the bubble is the
      // same live and after a replay. Display only — order stays with `seq`.
      settle(conv, id, { type: 'ackAccepted' }, { ts: ack.ts });
      return;
    }
    settle(conv, id, { type: 'ackRejected', code: ack.code });
    // No turn will come of a message the agent never got. Leave the shimmer
    // alone if something else is still on its way or visibly in progress.
    const inFlight = messagesFor(key).some(
      (m) =>
        m.delivery === BridleDeliveryStates.Sending ||
        m.delivery === BridleDeliveryStates.Slow,
    );
    if (!inFlight && !hasOpenThinking(key)) {
      pending.value[key] = false;
      disarmWatchdog(key);
    }
  }

  /** Try a message that was not delivered again — same id, text and files. */
  function resend(conv: IBridleConversation, id: string) {
    const message = findMessage(conv.key, id);
    if (message?.delivery !== BridleDeliveryStates.Failed) return;
    errors.value[conv.key] = null;
    applyDelivery(conv, id, { type: 'resend' });
    transmit(conv, id);
  }

  /** Drop a message that was not delivered. Anything else is history. */
  function discard(conv: IBridleConversation, id: string) {
    const message = findMessage(conv.key, id);
    if (message?.delivery !== BridleDeliveryStates.Failed) return;
    removeMessage(conv, id);
  }

  function removeMessage(conv: IBridleConversation, id: string) {
    const list = conversations.value[conv.key];
    const index = list?.findIndex((m) => m.id === id) ?? -1;
    if (!list || index === -1) return;
    list.splice(index, 1);
    persist(conv);
  }

  function dismissError(conv: IBridleConversation) {
    errors.value[conv.key] = null;
  }

  function reset(conv: IBridleConversation) {
    clearStaged(conv);
    for (const m of messagesFor(conv.key)) {
      const timer = slowTimers.get(m.id);
      if (timer) clearTimeout(timer);
      slowTimers.delete(m.id);
    }
    delete conversations.value[conv.key];
    delete pending.value[conv.key];
    delete errors.value[conv.key];
    delete drafts.value[conv.key];
    delete thinking.value[conv.key];
    closedTurns.delete(conv.key);
    // `lastHubSeqs` stays: the hub keeps counting, and frames of the
    // conversation just cleared must not be replayed into the new one.
    nextSeqs.delete(conv.key);
    disarmWatchdog(conv.key);
    clearConversationFromStorage(conv.key);
  }

  return {
    conversations,
    messagesFor,
    isPending,
    errorFor,
    dismissError,
    draftFor,
    clearDraft,
    hydrate,
    sendMessage,
    resend,
    discard,
    reset,
    // live channel
    acquire,
    release,
    connectionFor,
    thinkingFor,
    hasOpenThinking,
    isShareRevoked,
    // attachments
    stagedFor,
    attachmentErrorFor,
    isUploading,
    hasFailedAttachment,
    canSend,
    stageFiles,
    removeStaged,
    retryStaged,
    clearStaged,
    dismissAttachmentError,
    fetchAttachment,
  };
});

/** Membership test hoisted out of the hot path in `stageFiles`. */
const ALLOWED_SET = new Set<string>([
  ...IMAGE_MIME_TYPES,
  ...TEXT_MIME_TYPES,
  ...BINARY_MIME_TYPES,
]);
