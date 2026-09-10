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
  BridleThinkingBlockStates,
  BridleThinkingStepStates,
} from '#bridle/domain';
import type {
  BridleService,
  IBridleAttachment,
  IBridleAttachmentError,
  IBridleChannel,
  IBridleConversation,
  IBridleMessage,
  IBridleNotice,
  IBridleReply,
  IBridleStagedAttachment,
  IBridleThinkingBlock,
  IBridleThinkingEvent,
} from '#bridle/domain';

// Re-export the domain enums/types so consumers importing them from
// `#bridle/stores/bridle` (Message.vue) keep working. The enums are used as
// runtime values, so they're value re-exports (not `export type`).
export {
  BridleRoleTypes,
  BridleAttachmentKinds,
  BridleAttachmentStates,
  BridleChannelStates,
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
   * content lands (or the turn dies). Gates the composer and drives the
   * shimmer status line when no thinking block is open.
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
  const channels = new Map<string, IBridleChannel>();
  const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
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
   */
  function canSend(key: string, draft: string): boolean {
    if (isPending(key)) return false;
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
      conversations.value[key] = stored.map(({ streaming: _s, ...m }) => m);
    }
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

  function appendMessage(conv: IBridleConversation, message: IBridleMessage) {
    if (!conversations.value[conv.key]) conversations.value[conv.key] = [];
    conversations.value[conv.key].push(message);
    persist(conv);
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

  function armWatchdog(key: string) {
    const current = watchdogs.get(key);
    if (current) clearTimeout(current);
    watchdogs.set(
      key,
      setTimeout(() => {
        watchdogs.delete(key);
        pending.value[key] = false;
        closeAllTurns(key);
      }, THINKING_STALE_MS),
    );
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

  /** Terminal paths (watchdog, disconnect): seal segments AND close their
   *  turns so a straggler step cannot resurrect a zombie segment. */
  function closeAllTurns(key: string) {
    const closed = closedTurns.get(key) ?? new Set<string>();
    for (const b of thinkingFor(key)) closed.add(b.turnId);
    closedTurns.set(key, closed);
    freezeOpenThinking(key);
    disarmWatchdog(key);
  }

  function onThinking(conv: IBridleConversation, e: IBridleThinkingEvent) {
    const key = conv.key;
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
      armWatchdog(key);
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
      // Anchor after every message on screen — wire ts is agent-clock.
      const list = messagesFor(key);
      const lastTs = list[list.length - 1]?.ts ?? 0;
      block = {
        turnId: e.turnId,
        seg: turnBlocks.length,
        steps: [],
        state: BridleThinkingBlockStates.Thinking,
        ts: Math.max(e.ts, lastTs + 1),
      };
      blocks.push(block);
    }
    block.steps.push(step);
    // Steps mean the agent is working — keep the shimmer alive through tool
    // execution and re-arm the watchdog.
    pending.value[key] = true;
    armWatchdog(key);
  }

  function onStream(
    conv: IBridleConversation,
    reply: IBridleReply,
    done: boolean,
  ) {
    const key = conv.key;
    // Streaming is activity too — keep the stale watchdog fed so an open
    // block only freezes when the turn truly went silent.
    if (!done && hasOpenThinking(key)) armWatchdog(key);
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
    pending.value[key] = false;
    if (!reply.text.trim()) return;
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
        channels.get(key)?.reconnect();
      } else {
        auth.endSession(code);
      }
      return;
    }
    errors.value[key] = { key: 'chat.error_rejected', params: { code } };
  }

  /**
   * Open the live channel for a conversation. Idempotent — the Provider calls
   * it whenever its conversation key settles, and a channel that is already
   * open is left alone. The console makes sure its bearer is not about to
   * expire first: the hub would refuse it a moment later.
   */
  async function connect(conv: IBridleConversation) {
    const key = conv.key;
    if (channels.has(key)) return;
    connection.value[key] = BridleChannelStates.Connecting;
    if (!conv.share) await useAuthStore().ensureFresh();
    // Someone else connected (or the chat unmounted) while that was in flight.
    if (
      channels.has(key) ||
      connection.value[key] !== BridleChannelStates.Connecting
    ) {
      return;
    }

    const channel = getService().openChannel(
      conv.agentId,
      conv.share
        ? { share: conv.share }
        : { token: () => useAuthStore().accessToken },
      {
        onConnected() {
          connection.value[key] = BridleChannelStates.Connected;
          authRetried.delete(key);
          // A stale "not connected" notice is answered by the reconnect itself.
          if (errors.value[key]?.key === 'chat.error_offline') {
            errors.value[key] = null;
          }
        },
        onDisconnected() {
          connection.value[key] = BridleChannelStates.Offline;
          // Nothing can finish an in-flight turn on a dead socket.
          pending.value[key] = false;
          closeAllTurns(key);
        },
        onRejected: (code) => void onRejected(conv, code),
        onMessageError(message) {
          pending.value[key] = false;
          errors.value[key] = {
            key: 'chat.error_message',
            params: { message },
          };
        },
        onTyping() {
          pending.value[key] = true;
          armWatchdog(key);
        },
        onThinking: (e) => onThinking(conv, e),
        onStream: (reply, done) => onStream(conv, reply, done),
        onMessage: (reply) => onMessage(conv, reply),
      },
    );
    channels.set(key, channel);
  }

  /** Close the channel. Messages stay: they are persisted, the socket is not. */
  function disconnect(conv: IBridleConversation) {
    const key = conv.key;
    channels.get(key)?.close();
    channels.delete(key);
    connection.value[key] = BridleChannelStates.Offline;
    pending.value[key] = false;
    closeAllTurns(key);
  }

  // ── Sending ────────────────────────────────────────────────

  function sendMessage(conv: IBridleConversation, text: string) {
    const key = conv.key;
    const trimmed = text.trim();
    const ready = stagedFor(key).filter(
      (a) => a.state === BridleAttachmentStates.Ready && a.remoteId,
    );

    if (pending.value[key]) return;
    if (!trimmed && !ready.length) return;
    // Refuse rather than silently dropping the file the message is about.
    if (isUploading(key) || hasFailedAttachment(key)) return;

    const channel = channels.get(key);
    if (!channel || connectionFor(key) !== BridleChannelStates.Connected) {
      // The composer already cleared itself; the draft mechanism (CLEAN-72)
      // hands the text straight back so nothing typed is lost. Staged files
      // are left where they are.
      if (trimmed) drafts.value[key] = trimmed;
      errors.value[key] = { key: 'chat.error_offline' };
      return;
    }

    const attachments: IBridleAttachment[] = ready.map((a) => ({
      id: a.remoteId as string,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind,
      url: `/api/agent/${encodeURIComponent(conv.agentId)}/attachment/${a.remoteId}`,
      readableByAgent: isReadableByAgent(a.kind, a.mimeType),
    }));

    appendMessage(conv, {
      id: `u-${Date.now()}`,
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    });

    // Clear the compose area before the round trip so the person can start
    // typing the next message while the agent thinks.
    clearStaged(conv);
    pending.value[key] = true;
    errors.value[key] = null;
    armWatchdog(key);

    channel.send(
      trimmed || EMPTY_TEXT_PLACEHOLDER,
      attachments.length ? attachments.map((a) => a.id) : undefined,
    );
  }

  function dismissError(conv: IBridleConversation) {
    errors.value[conv.key] = null;
  }

  function reset(conv: IBridleConversation) {
    clearStaged(conv);
    delete conversations.value[conv.key];
    delete pending.value[conv.key];
    delete errors.value[conv.key];
    delete drafts.value[conv.key];
    delete thinking.value[conv.key];
    closedTurns.delete(conv.key);
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
    reset,
    // live channel
    connect,
    disconnect,
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
