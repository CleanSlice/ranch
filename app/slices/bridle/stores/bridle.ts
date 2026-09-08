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
import { BridleAttachmentKinds } from '#bridle/domain';
import type {
  BridleService,
  IBridleAttachment,
  IBridleAttachmentError,
  IBridleConversation,
  IBridleMessage,
  IBridleStagedAttachment,
} from '#bridle/domain';

// Re-export the domain enums/types so consumers importing them from
// `#bridle/stores/bridle` (Message.vue) keep working. The enums are used as
// runtime values, so they're value re-exports (not `export type`).
export {
  BridleRoleTypes,
  BridleAttachmentKinds,
  BridleAttachmentStates,
} from '#bridle/domain';
export type {
  IBridleMessage,
  IBridleReply,
  IBridleAttachment,
  IBridleAttachmentError,
  IBridleStagedAttachment,
  IBridleConversation,
  IBridleShareContext,
} from '#bridle/domain';

const getService = createServiceGetter<BridleService>('$bridleService');

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
  const pending = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | null>>({});
  /** Conversations already pulled from localStorage. */
  const hydrated = ref<Record<string, boolean>>({});
  /** Files picked but not yet sent, keyed by conversation like everything here. */
  const staged = ref<Record<string, IBridleStagedAttachment[]>>({});
  /** Last rejection, surfaced once and then dismissed by the next action. */
  const attachmentErrors = ref<Record<string, IBridleAttachmentError | null>>({});

  // Read side takes the bare `key` — a template already holds the descriptor
  // and passing the whole object just to look up an array buys nothing.
  const messagesFor = (key: string) => conversations.value[key] ?? [];
  const isPending = (key: string) => pending.value[key] === true;
  const errorFor = (key: string) => errors.value[key] ?? null;
  const stagedFor = (key: string) => staged.value[key] ?? [];
  const attachmentErrorFor = (key: string) => attachmentErrors.value[key] ?? null;

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
    if (stored && stored.length) conversations.value[key] = stored;
  }

  function persist(conv: IBridleConversation) {
    const messages = conversations.value[conv.key];
    if (messages && messages.length) {
      saveConversationToStorage(conv.key, messages);
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

  // ── Sending ────────────────────────────────────────────────

  async function sendMessage(conv: IBridleConversation, text: string) {
    const key = conv.key;
    const trimmed = text.trim();
    const ready = stagedFor(key).filter(
      (a) => a.state === BridleAttachmentStates.Ready && a.remoteId,
    );

    if (pending.value[key]) return;
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

    appendMessage(conv, {
      id: `u-${Date.now()}`,
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    });

    // Clear the compose area before awaiting so the person can start typing
    // the next message while the agent thinks.
    clearStaged(conv);

    pending.value[key] = true;
    errors.value[key] = null;

    try {
      const reply = await getService().sendMessage(
        conv.agentId,
        trimmed || EMPTY_TEXT_PLACEHOLDER,
        attachments.length ? attachments.map((a) => a.id) : undefined,
        conv.share,
      );
      appendMessage(conv, {
        id: reply.messageId || `a-${Date.now()}`,
        role: BridleRoleTypes.Agent,
        text: reply.text,
        ts: reply.ts ?? Date.now(),
      });
    } catch (err) {
      errors.value[key] =
        (err as Error).message || 'Failed to reach agent';
    } finally {
      pending.value[key] = false;
    }
  }

  function reset(conv: IBridleConversation) {
    clearStaged(conv);
    delete conversations.value[conv.key];
    delete pending.value[conv.key];
    delete errors.value[conv.key];
    clearConversationFromStorage(conv.key);
  }

  return {
    conversations,
    messagesFor,
    isPending,
    errorFor,
    hydrate,
    sendMessage,
    reset,
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
