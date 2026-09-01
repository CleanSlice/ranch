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
  resolveMimeType,
} from '#bridle/domain';
import { BridleAttachmentKinds } from '#bridle/domain';
import type {
  BridleService,
  IBridleAttachment,
  IBridleAttachmentError,
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
} from '#bridle/domain';

const getService = createServiceGetter<BridleService>('$bridleService');

// localStorage persistence for chat conversations — survives page refresh.
// Scoped per agentId so switching agents doesn't bleed history. Mirrors the
// admin's per-bot persistence pattern for debug snapshots.
const CONVERSATION_STORAGE_PREFIX = 'bridle:conversation:';

/**
 * Sent with attachments when the person typed nothing. The shared
 * SendMessageDto keeps `text` as @IsNotEmpty() because the embed widget and
 * the admin chat post to the same endpoint — relaxing it there to satisfy a
 * console-only case would change validation for every caller.
 */
const EMPTY_TEXT_PLACEHOLDER = ' ';

function loadConversationFromStorage(agentId: string): IBridleMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_PREFIX + agentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IBridleMessage[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[bridle] failed to load persisted conversation', err);
    return null;
  }
}

function saveConversationToStorage(
  agentId: string,
  messages: IBridleMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CONVERSATION_STORAGE_PREFIX + agentId,
      JSON.stringify(messages),
    );
  } catch (err) {
    // Quota exceeded or storage disabled — best-effort, ignore.
    console.warn('[bridle] failed to persist conversation', err);
  }
}

function clearConversationFromStorage(agentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_PREFIX + agentId);
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
  /** Bots whose conversation has been pulled from localStorage already. */
  const hydrated = ref<Record<string, boolean>>({});
  /** Files picked but not yet sent, keyed by agent like everything else here. */
  const staged = ref<Record<string, IBridleStagedAttachment[]>>({});
  /** Last rejection, surfaced once and then dismissed by the next action. */
  const attachmentErrors = ref<Record<string, IBridleAttachmentError | null>>({});

  const messagesFor = (agentId: string) => conversations.value[agentId] ?? [];
  const isPending = (agentId: string) => pending.value[agentId] === true;
  const errorFor = (agentId: string) => errors.value[agentId] ?? null;
  const stagedFor = (agentId: string) => staged.value[agentId] ?? [];
  const attachmentErrorFor = (agentId: string) =>
    attachmentErrors.value[agentId] ?? null;

  const isUploading = (agentId: string) =>
    stagedFor(agentId).some((a) => a.state === BridleAttachmentStates.Uploading);
  const hasFailedAttachment = (agentId: string) =>
    stagedFor(agentId).some((a) => a.state === BridleAttachmentStates.Failed);

  /**
   * Sending is allowed with text OR at least one ready attachment, and is
   * blocked while anything is still uploading or has failed — an incomplete
   * message would reach the agent missing exactly the file it was about.
   */
  function canSend(agentId: string, draft: string): boolean {
    if (isPending(agentId)) return false;
    if (isUploading(agentId) || hasFailedAttachment(agentId)) return false;
    const hasReady = stagedFor(agentId).some(
      (a) => a.state === BridleAttachmentStates.Ready,
    );
    return draft.trim().length > 0 || hasReady;
  }

  /**
   * Replay persisted messages for the given bot from localStorage. Idempotent —
   * called from the Provider on mount so the chat survives a page refresh.
   * Avoids overwriting an existing in-memory conversation (e.g. if the user
   * navigated away and back without reloading).
   */
  function hydrate(agentId: string) {
    if (hydrated.value[agentId]) return;
    hydrated.value[agentId] = true;
    if (conversations.value[agentId]?.length) return;
    const stored = loadConversationFromStorage(agentId);
    if (stored && stored.length) conversations.value[agentId] = stored;
  }

  function persist(agentId: string) {
    const messages = conversations.value[agentId];
    if (messages && messages.length) saveConversationToStorage(agentId, messages);
    else clearConversationFromStorage(agentId);
  }

  function appendMessage(agentId: string, message: IBridleMessage) {
    if (!conversations.value[agentId]) conversations.value[agentId] = [];
    conversations.value[agentId].push(message);
    persist(agentId);
  }

  // ── Attachments ────────────────────────────────────────────

  /**
   * Validate a picked file against the client mirror of the API's limits.
   * Returns a translation key rather than a sentence — copy assembled in
   * script is invisible to the i18n extraction sweep.
   */
  function validate(
    agentId: string,
    file: File,
    pendingBytes: number,
  ): IBridleAttachmentError | null {
    if (stagedFor(agentId).length >= MAX_ATTACHMENTS_PER_MESSAGE) {
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
  function stageFiles(agentId: string, files: File[] | FileList) {
    const list = Array.from(files);
    if (!list.length) return;
    if (!staged.value[agentId]) staged.value[agentId] = [];
    attachmentErrors.value[agentId] = null;

    let pendingBytes = stagedFor(agentId).reduce((sum, a) => sum + a.size, 0);

    for (const file of list) {
      const mimeType = resolveMimeType(file);
      const allowed = ALLOWED_SET.has(mimeType);
      const problem = !allowed
        ? { key: 'chat.error_type', params: { name: file.name } }
        : validate(agentId, file, pendingBytes);

      if (problem) {
        attachmentErrors.value[agentId] = problem;
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

      staged.value[agentId].push(staging);
      pendingBytes += file.size;
      void upload(agentId, staging.localId);
    }
  }

  function findStaged(
    agentId: string,
    localId: string,
  ): IBridleStagedAttachment | undefined {
    return staged.value[agentId]?.find((a) => a.localId === localId);
  }

  async function upload(agentId: string, localId: string) {
    const entry = findStaged(agentId, localId);
    if (!entry) return;

    entry.state = BridleAttachmentStates.Uploading;
    entry.progress = 0;
    entry.error = null;

    try {
      const stored = await getService().uploadAttachment(
        agentId,
        entry.file,
        (percent) => {
          // The chip may have been removed mid-flight.
          const live = findStaged(agentId, localId);
          if (live) live.progress = percent;
        },
      );
      const live = findStaged(agentId, localId);
      if (!live) return;
      live.remoteId = stored.id;
      live.kind = stored.kind;
      live.mimeType = stored.mimeType;
      live.progress = 100;
      live.state = BridleAttachmentStates.Ready;
    } catch (err) {
      const live = findStaged(agentId, localId);
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

  function retryStaged(agentId: string, localId: string) {
    const entry = findStaged(agentId, localId);
    if (!entry || entry.state === BridleAttachmentStates.Uploading) return;
    void upload(agentId, localId);
  }

  function revoke(entry: IBridleStagedAttachment) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }

  function removeStaged(agentId: string, localId: string) {
    const list = staged.value[agentId];
    if (!list) return;
    const index = list.findIndex((a) => a.localId === localId);
    if (index < 0) return;
    revoke(list[index]);
    list.splice(index, 1);
    attachmentErrors.value[agentId] = null;
  }

  function clearStaged(agentId: string) {
    for (const entry of staged.value[agentId] ?? []) revoke(entry);
    staged.value[agentId] = [];
    attachmentErrors.value[agentId] = null;
  }

  function dismissAttachmentError(agentId: string) {
    attachmentErrors.value[agentId] = null;
  }

  /**
   * Read a sent attachment back so the transcript can show it. Not cached
   * here: the caller turns the blob into an object URL and owns revoking it,
   * and a cache in the store would keep every image of every conversation
   * alive for the life of the tab.
   */
  function fetchAttachment(agentId: string, attachmentId: string) {
    return getService().fetchAttachment(agentId, attachmentId);
  }

  // ── Sending ────────────────────────────────────────────────

  async function sendMessage(agentId: string, text: string) {
    const trimmed = text.trim();
    const ready = stagedFor(agentId).filter(
      (a) => a.state === BridleAttachmentStates.Ready && a.remoteId,
    );

    if (pending.value[agentId]) return;
    if (!trimmed && !ready.length) return;
    // Refuse rather than silently dropping the file the message is about.
    if (isUploading(agentId) || hasFailedAttachment(agentId)) return;

    const attachments: IBridleAttachment[] = ready.map((a) => ({
      id: a.remoteId as string,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind,
      url: `/api/agent/${encodeURIComponent(agentId)}/attachment/${a.remoteId}`,
      readableByAgent: a.kind !== BridleAttachmentKinds.Binary,
    }));

    appendMessage(agentId, {
      id: `u-${Date.now()}`,
      role: BridleRoleTypes.User,
      text: trimmed,
      ts: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    });

    // Clear the compose area before awaiting so the person can start typing
    // the next message while the agent thinks.
    clearStaged(agentId);

    pending.value[agentId] = true;
    errors.value[agentId] = null;

    try {
      const reply = await getService().sendMessage(
        agentId,
        trimmed || EMPTY_TEXT_PLACEHOLDER,
        attachments.length ? attachments.map((a) => a.id) : undefined,
      );
      appendMessage(agentId, {
        id: reply.messageId || `a-${Date.now()}`,
        role: BridleRoleTypes.Agent,
        text: reply.text,
        ts: reply.ts ?? Date.now(),
      });
    } catch (err) {
      errors.value[agentId] =
        (err as Error).message || 'Failed to reach agent';
    } finally {
      pending.value[agentId] = false;
    }
  }

  function reset(agentId: string) {
    clearStaged(agentId);
    delete conversations.value[agentId];
    delete pending.value[agentId];
    delete errors.value[agentId];
    clearConversationFromStorage(agentId);
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
