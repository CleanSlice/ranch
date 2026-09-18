import { markRaw } from 'vue'
import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '#auth/stores/auth'
import { authedFetch, authedXhrHeaders, ensureFreshToken } from '#auth/utils/authedFetch'
import {
  BridleAttachmentKinds,
  BridleAttachmentStates,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  formatBytes,
  isAllowedMimeType,
  readAsBase64,
  resolveKind,
  resolveMimeType,
  type IStagedAttachment,
  type IUploadedAttachment,
} from '../utils/attachment'
import { nextSeq, numberLegacy } from '../utils/chatFlow'
import {
  FAILED_MS,
  SLOW_MS,
  nextDelivery,
  type BridleDelivery,
  type DeliveryEvent,
} from '../utils/delivery'

export enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}

export interface IBridleTextPart {
  type: BridlePartTypes.Text
  text: string
}

export interface IBridleImagePart {
  type: BridlePartTypes.Image
  base64: string
  mediaType: string
}

export interface IBridleFilePart {
  type: BridlePartTypes.File
  url: string
  name: string
  mimeType?: string
}

export type BridlePart = IBridleTextPart | IBridleImagePart | IBridleFilePart

/**
 * Stored-attachment reference. Metadata only — the bytes stay behind
 * `GET /api/agent/:id/attachment/:id`, which needs the bearer, so the store
 * downloads them and hands the DOM base64/object URLs.
 */
export interface IBridleAttachmentRef {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'text' | 'binary'
}

/** What the hub answers a `message` with (contracts/bridle-socket.md). */
export type BridleSendAck =
  | { status: 'accepted'; messageId: string; ts: number; duplicate?: true }
  | { status: 'rejected'; code: string; message?: string }

export interface IBridleMessageData {
  /**
   * One id per message end to end: the operator's message uses the UUID minted
   * at send (also its `clientMessageId` on the wire), an agent message the wire
   * `messageId`, a replayed message the transcript event id.
   */
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  /** Display only — two clocks stamp it. Never used for ordering (see `seq`). */
  ts: number
  /**
   * Per-conversation arrival sequence, assigned by the store on append. The
   * only ordering key (utils/chatFlow.ts).
   */
  seq?: number
  /** Operator's messages only. Absent means delivered (replayed messages). */
  delivery?: BridleDelivery
  /** Why `delivery` is `failed` — drives the wording under the bubble. */
  failureCode?: string
  /**
   * References of the files sent with the operator's message. Kept so a resend
   * — also after a reload, from the outbox — carries the same attachments.
   */
  attachments?: IBridleAttachmentRef[]
  /** Came from the transcript, not from this session's live traffic. */
  replayed?: true
  streaming?: boolean
  /**
   * Replayed user turns with attachments only: the full text the model
   * received (typed text + inlined attachment blocks). Shown on demand under
   * the DEBUG toggle, never as the bubble. Absent on the live echo.
   */
  agentText?: string
}

// ── Thinking (live reasoning steps) ──────────────────────────
// Mirrors the wire contract in api/src/slices/bridle/domain/bridle.types.ts.

/**
 * The structured half of a delegation step (CLEAN-74). Present only on steps
 * the API publishes; a runtime step has neither field, which is what keeps
 * this additive.
 */
export interface IBridleDelegationStep {
  delegationId: string
  peerAgentId: string
  peerName: string
  matchedSkills: { id: string; name: string }[]
  reason: string
  task: string
  status: 'waiting' | 'answered' | 'failed' | 'rejected'
  /** Epoch ms — the client ticks its own elapsed time while waiting. */
  startedAt: number
  durationMs?: number
  excerpt?: string
}

export interface IBridleThinkingStep {
  id: string
  label: string
  detail?: string
  state: 'active' | 'done'
  kind?: 'delegation'
  delegation?: IBridleDelegationStep
}

export interface IBridleThinkingEvent {
  type: 'thinking'
  clientId: string
  turnId: string
  step?: IBridleThinkingStep
  done?: boolean
  ts: number
}

/**
 * One SEGMENT of a turn's thinking timeline. A turn may produce several
 * segments: a segment seals (collapses) as soon as assistant content lands
 * below it, and the next step opens a fresh segment under that message —
 * so the current activity always renders at the bottom of the flow.
 * Session-only — not persisted.
 */
export interface IThinkingBlock {
  turnId: string
  /** Segment ordinal within the turn — with turnId forms the render key. */
  seg: number
  steps: IBridleThinkingStep[]
  status: 'thinking' | 'done'
  ts: number
  /** Arrival sequence, assigned when the segment opens — orders it in the flow. */
  seq?: number
}

/**
 * Snapshot of an LLM round-trip, sent by the runtime over the "debug" WS
 * event. Hub fans this out only to admin clients.
 */
export interface IBridleDebugData {
  messageId?: string
  ts: number
  model: string
  provider: string
  systemPrompt: string
  history: unknown[]
  response: {
    text: string
    toolCalls?: Array<{ name: string; params: unknown }>
    stopReason?: string
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    credentialId?: string
  }
  latencyMs: number
}

/**
 * localStorage persistence for debug snapshots — survives a page refresh so
 * the inspect icon doesn't disappear after every reload. Scoped per agentId so
 * switching agents doesn't bleed.
 */
const DEBUG_STORAGE_PREFIX = 'bridle:debug:'
const MARKDOWN_STORAGE_KEY = 'bridle:markdownEnabled'

function loadMarkdownPref(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(MARKDOWN_STORAGE_KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

function saveMarkdownPref(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MARKDOWN_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore — preference is best-effort
  }
}

interface IPersistedDebug {
  byMessageId: Record<string, IBridleDebugData>
  lastDebug: IBridleDebugData | null
}

function loadDebugFromStorage(agentId: string): IPersistedDebug | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DEBUG_STORAGE_PREFIX + agentId)
    if (!raw) return null
    return JSON.parse(raw) as IPersistedDebug
  } catch (err) {
    console.warn('[bridle] failed to load persisted debug', err)
    return null
  }
}

function saveDebugToStorage(agentId: string, payload: IPersistedDebug): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      DEBUG_STORAGE_PREFIX + agentId,
      JSON.stringify(payload),
    )
  } catch (err) {
    // Quota exceeded or storage disabled — debug is best-effort, ignore.
    console.warn('[bridle] failed to persist debug', err)
  }
}

function clearDebugFromStorage(agentId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DEBUG_STORAGE_PREFIX + agentId)
  } catch {
    // ignore
  }
}

// Initial page size for transcript load + each scroll-up load. 50 messages
// covers the typical visible window without needing an immediate second page.
const TRANSCRIPT_PAGE_SIZE = 50

/** Stored-attachment reference riding a transcript message. */
type ITranscriptAttachment = IBridleAttachmentRef

interface ITranscriptPageMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
  attachments?: ITranscriptAttachment[]
  agentText?: string
}

interface ITranscriptPage {
  messages: ITranscriptPageMessage[]
  channel: string
  nextCursor: string | null
  hasMore: boolean
}

/**
 * GET the transcript replay endpoint. The endpoint wraps the response in the
 * Ranch `{ success, data }` envelope; we accept either shape so the store
 * survives changes to the global response interceptor.
 *
 * `authedFetch` carries the current bearer and refreshes-and-retries once on
 * an expired token; a 401 it could not recover has already moved the auth
 * store to the session-ended state, so here it is just "no page".
 */
async function fetchTranscriptPage(
  apiUrl: string,
  agentId: string,
  channel: string,
  cursor?: string,
): Promise<ITranscriptPage | null> {
  const params = new URLSearchParams({ channel })
  params.set('limit', String(TRANSCRIPT_PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?${params.toString()}`
  const res = await authedFetch(url)
  if (!res.ok) {
    console.warn('[bridle] transcript fetch returned', res.status)
    return null
  }
  type TranscriptEnvelope = { data?: ITranscriptPage } & ITranscriptPage
  const body = (await res.json()) as TranscriptEnvelope
  const payload = body.data ?? body
  return {
    messages: payload.messages ?? [],
    channel: payload.channel ?? channel,
    nextCursor: payload.nextCursor ?? null,
    hasMore: !!payload.hasMore,
  }
}

/**
 * Upload one attachment and report progress.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload-progress event,
 * and a 10 MB file with no progress bar reads as a hang. XHR gets no
 * refresh-and-retry, so the token is renewed *before* the bytes leave when it
 * is close to expiry — a 10 MB upload must not die at the finish line.
 */
async function uploadAttachment(
  apiUrl: string,
  agentId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<IUploadedAttachment> {
  const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/attachment`
  await ensureFreshToken()
  const headers = authedXhrHeaders()

  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value)
    }

    xhr.upload.onprogress = (e) => {
      // `lengthComputable` is false behind some proxies — leave the bar where
      // it is rather than dividing by zero.
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status})`))
        return
      }
      try {
        const body = JSON.parse(xhr.responseText) as {
          data?: IUploadedAttachment
        }
        // Every 2xx is wrapped in { success, data }; peel it here so callers
        // see the DTO.
        const dto = body?.data ?? (body as unknown as IUploadedAttachment)
        if (!dto?.id) throw new Error('missing id')
        resolve(dto)
      } catch {
        reject(new Error('Upload returned an unreadable response'))
      }
    }
    xhr.send(form)
  })
}

function toBridleMessage(m: ITranscriptPageMessage): IBridleMessageData {
  return {
    id: m.id,
    role: m.role,
    // `text` is what the person typed — the API already took the attachment
    // blocks off; they come back separately as `agentText` for inspection.
    text: m.text,
    // No empty text part: an attachment-only message (text '') would render
    // a blank line above its image once hydration fills the parts in.
    parts: m.text ? [{ type: BridlePartTypes.Text as const, text: m.text }] : [],
    ts: m.ts,
    replayed: true,
    ...(m.agentText ? { agentText: m.agentText } : {}),
  }
}

function buildParts(text: string, images?: Array<{ base64: string; mediaType: string }>): BridlePart[] {
  const parts: BridlePart[] = []
  if (text) parts.push({ type: BridlePartTypes.Text, text })
  if (images) {
    for (const img of images) {
      parts.push({ type: BridlePartTypes.Image, base64: img.base64, mediaType: img.mediaType })
    }
  }
  return parts
}

// Tool-only LLM iterations cause the runtime's bridle channel to emit
// stream/stream_end events with empty text. Without this guard each one
// renders as an empty chat bubble.
function hasVisibleContent(text: string, parts: BridlePart[]): boolean {
  if (text && text.trim().length > 0) return true
  return parts.some(p => {
    if (p.type === BridlePartTypes.Image || p.type === BridlePartTypes.File) return true
    return p.type === BridlePartTypes.Text && p.text.trim().length > 0
  })
}

// ── Conversations ────────────────────────────────────────────
// One record per conversation, keyed `<agentId>:<channel>`. Before CLEAN-102
// this store held ONE message list, ONE socket and ONE set of flags for every
// mounted chat, so the Rancher panel and an agent's Chat tab wrote into each
// other's conversation (research F3). Everything a chat renders from now lives
// in its own record; only what is genuinely app-wide stays global.

/** The admin panel's channel — every Owner/Admin shares it. */
const DEFAULT_CHANNEL = 'admin'

/** Key of one conversation record. */
export function bridleKey(agentId: string, channel = DEFAULT_CHANNEL): string {
  return `${agentId}:${channel}`
}

export interface IBridleConversation {
  key: string
  agentId: string
  channel: string
  /** Captured on connect — the socket's own recoveries need it (transcript merge). */
  apiUrl: string | null
  /**
   * Mounted providers showing this conversation. The socket closes when the
   * last one leaves, so a provider that unmounts during a route change cannot
   * cut off the one that just mounted for the same key.
   */
  holders: number
  messages: IBridleMessageData[]
  /**
   * Live thinking timelines, one per agent turn — opened by the first
   * `thinking` event, frozen by its terminal `done` event (or when the stale
   * watchdog fires). Session-only.
   */
  thinkingBlocks: IThinkingBlock[]
  /** Turns terminally closed (done event / watchdog / deliberate disconnect) —
   * straggler steps for these must not resurrect a segment. */
  closedTurns: Record<string, true>
  /** Next arrival sequence to hand out — see `IBridleMessageData.seq`. */
  nextSeq: number
  /**
   * Highest hub `seq` applied. Sent as `lastSeq` on every (re)connect so the
   * hub replays what a reconnect gap swallowed; anything at or below it is a
   * replay overlap and is ignored.
   */
  lastHubSeq: number
  /**
   * `ts` of the newest message the loaded transcript holds (runtime clock).
   * Agent content stamped at or before it is already on screen as transcript.
   */
  transcriptTailTs: number
  /**
   * Opaque cursor returned by the API for fetching older messages. `null`
   * means there are no more older messages to load (or transcript hasn't
   * been fetched yet — `hasMoreOlder` distinguishes those).
   */
  transcriptCursor: string | null
  hasMoreOlder: boolean
  loadingOlder: boolean
  isConnected: boolean
  /**
   * Whether the agent runtime is currently registered with the bridle hub.
   * Pushed by the hub via the `agent_status` event on connect and on every
   * runtime register/unregister. Independent of `isConnected` (the client's
   * own WS) — the chat header needs both signals to color the indicator.
   */
  isAgentConnected: boolean
  isTyping: boolean
  clientId: string | null
  /** Plain line under the flow — a turn that died without an answer says so. */
  notice: string | null
  /**
   * Debug snapshots keyed by messageId when the runtime supplies one;
   * otherwise stored in `lastDebug` and attached to the most recent
   * assistant message via `getDebugForMessage`.
   */
  debugByMessageId: Record<string, IBridleDebugData>
  lastDebug: IBridleDebugData | null
  /**
   * Local mirror of the agent's `debugEnabled` flag, populated by
   * `loadAgentMeta`. UI reads this to render the toggle state. Persistent
   * source of truth lives on the API; runtime gets it via WS push.
   */
  debugEnabled: boolean
  /** Files picked but not yet sent. Emptied when the message goes out. */
  staged: IStagedAttachment[]
  /** Last rejection, shown under the composer until the next action. */
  attachmentError: string | null
  /**
   * Object URLs minted for the local echo of a sent non-image attachment.
   * The download route needs a bearer token and a plain link cannot carry
   * one, so the bubble links the bytes we already hold. Revoked when the
   * transcript is cleared.
   */
  echoUrls: string[]
  socket: Socket | null
  thinkingStaleTimer: ReturnType<typeof setTimeout> | null
  /**
   * One reconnect per auth rejection: after the hub refuses the token we
   * refresh and connect again once; a second refusal ends the session
   * instead of looping. Reset on every successful connect.
   */
  authRetried: boolean
}

function createConversation(agentId: string, channel: string): IBridleConversation {
  return {
    key: bridleKey(agentId, channel),
    agentId,
    channel,
    apiUrl: null,
    holders: 0,
    messages: [],
    thinkingBlocks: [],
    closedTurns: {},
    nextSeq: 1,
    lastHubSeq: 0,
    transcriptTailTs: 0,
    transcriptCursor: null,
    hasMoreOlder: false,
    loadingOlder: false,
    isConnected: false,
    isAgentConnected: false,
    isTyping: false,
    clientId: null,
    notice: null,
    debugByMessageId: {},
    lastDebug: null,
    debugEnabled: false,
    staged: [],
    attachmentError: null,
    echoUrls: [],
    socket: null,
    thinkingStaleTimer: null,
    authRetried: false,
  }
}

/**
 * False for a hub event this conversation has already applied — after a
 * reconnect the hub replays from `lastSeq`, and an overlap must be harmless.
 * An event without `seq` (older hub) always passes.
 */
function acceptHubSeq(c: IBridleConversation, seq: unknown): boolean {
  if (typeof seq !== 'number') return true
  if (seq <= c.lastHubSeq) return false
  c.lastHubSeq = seq
  return true
}

function hasOpenTurn(c: IBridleConversation): boolean {
  return (
    c.isTyping ||
    c.thinkingBlocks.some(b => b.status === 'thinking') ||
    c.messages.some(m => m.streaming)
  )
}

// ── Outbox ───────────────────────────────────────────────────
// The admin keeps no conversation locally — a reload shows the transcript. A
// message the agent never received is in no transcript, so without this it
// would vanish on reload, silently (research F2). The outbox holds exactly the
// operator's messages that are NOT delivered: text and attachment references,
// never image bytes.

const OUTBOX_STORAGE_PREFIX = 'bridle:outbox:'

interface IOutboxEntry {
  id: string
  text: string
  ts: number
  delivery: BridleDelivery
  failureCode?: string
  attachments?: IBridleAttachmentRef[]
}

function loadOutbox(key: string): IOutboxEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as IOutboxEntry[]).filter(
      e => !!e && typeof e.id === 'string' && typeof e.text === 'string',
    )
  } catch (err) {
    console.warn('[bridle] failed to load outbox', err)
    return []
  }
}

function saveOutbox(key: string, entries: IOutboxEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    if (!entries.length) {
      window.localStorage.removeItem(OUTBOX_STORAGE_PREFIX + key)
      return
    }
    window.localStorage.setItem(OUTBOX_STORAGE_PREFIX + key, JSON.stringify(entries))
  } catch (err) {
    // Quota exceeded or storage disabled — the message still shows its state
    // for this session; it just will not survive a reload.
    console.warn('[bridle] failed to persist outbox', err)
  }
}

/** How far a transcript copy's clock may sit from the local send time. */
const PERSISTED_MATCH_WINDOW_MS = 2 * 60_000

/**
 * Is this operator message already in the transcript page?
 *
 * By id — and, INTERIM, by exact text within ±2 minutes of its send time: the
 * runtime does not persist the message id yet (research E2), so the id alone
 * never matches today. Remove the text fallback once the runtime persists
 * message ids — tasks.md T044.
 */
function isInTranscript(
  m: { id: string; text: string; ts: number },
  page: ITranscriptPageMessage[],
): boolean {
  return page.some(
    t =>
      t.id === m.id ||
      (t.role === 'user' &&
        t.text === m.text &&
        Math.abs(t.ts - m.ts) <= PERSISTED_MATCH_WINDOW_MS),
  )
}

// "Still no ack after 5 s" timers, keyed `<conversation>|<message id>`. Not
// state: nothing renders from a timer handle.
const slowTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearSlowTimer(key: string, id: string): void {
  const handle = slowTimers.get(`${key}|${id}`)
  if (handle) clearTimeout(handle)
  slowTimers.delete(`${key}|${id}`)
}

/** How long a turn may stay silent before it is declared dead. */
const TURN_STALE_MS = 75_000

const TURN_DIED_NOTICE = 'The agent did not finish this turn.'

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    /** Every conversation this tab has touched, keyed by `bridleKey`. */
    conversations: {} as Record<string, IBridleConversation>,
    isOpen: false,
    /**
     * Render assistant messages as markdown when true; otherwise show raw
     * text. Persisted in localStorage so the user's choice survives refresh.
     */
    markdownEnabled: loadMarkdownPref(),
  }),

  getters: {
    getIsOpen: (state) => state.isOpen,
    // Read-only views for hosts that only watch a chat's connection (the
    // agent lifecycle, the Rancher page). They never create a record — a
    // conversation nobody mounted is simply "not connected".
    isConnectedFor: (state) => (agentId: string, channel = DEFAULT_CHANNEL): boolean =>
      state.conversations[bridleKey(agentId, channel)]?.isConnected ?? false,
    isAgentConnectedFor: (state) => (agentId: string, channel = DEFAULT_CHANNEL): boolean =>
      state.conversations[bridleKey(agentId, channel)]?.isAgentConnected ?? false,
    getMessages: (state) => (key: string): IBridleMessageData[] =>
      (state.conversations[key]?.messages ?? []) as IBridleMessageData[],
    isUploadingAttachment: (state) => (key: string): boolean =>
      (state.conversations[key]?.staged ?? []).some(
        a => a.state === BridleAttachmentStates.Uploading,
      ),
    /**
     * A failed upload blocks sending on purpose: the message is usually
     * *about* the file, and delivering it without the attachment is worse
     * than making the person retry or drop it.
     */
    hasFailedAttachment: (state) => (key: string): boolean =>
      (state.conversations[key]?.staged ?? []).some(
        a => a.state === BridleAttachmentStates.Failed,
      ),
    readyAttachments: (state) => (key: string): IStagedAttachment[] =>
      ((state.conversations[key]?.staged ?? []) as IStagedAttachment[]).filter(
        a => a.state === BridleAttachmentStates.Ready && a.remoteId,
      ),
    getDebugForMessage: (state) => (key: string, id: string): IBridleDebugData | null => {
      const c = state.conversations[key]
      if (!c) return null
      const direct = c.debugByMessageId[id]
      if (direct) return direct
      // No messageId match: only attach the orphan debug to the *latest*
      // assistant message — older assistant messages keep no debug.
      const lastAssistant = [...c.messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant && lastAssistant.id === id) return c.lastDebug
      return null
    },
  },

  actions: {
    /**
     * The reactive record of one conversation, created on demand. Call it from
     * setup or an action — not from inside a computed, which must not write.
     */
    conversation(agentId: string, channel = DEFAULT_CHANNEL): IBridleConversation {
      const key = bridleKey(agentId, channel)
      if (!this.conversations[key]) {
        this.conversations[key] = createConversation(agentId, channel)
      }
      return this.conversations[key] as IBridleConversation
    },

    _conv(key: string): IBridleConversation | null {
      return (this.conversations[key] as IBridleConversation | undefined) ?? null
    },

    /** A provider starts showing this conversation. Pair with `release`. */
    acquire(agentId: string, channel = DEFAULT_CHANNEL): IBridleConversation {
      const c = this.conversation(agentId, channel)
      c.holders++
      return c
    },

    /**
     * A provider stops showing this conversation. The last one out closes the
     * socket and drops staged files (their object URLs would leak). Messages
     * stay: the next mount merges the transcript into them.
     */
    release(key: string) {
      const c = this._conv(key)
      if (!c) return
      c.holders = Math.max(0, c.holders - 1)
      if (c.holders > 0) return
      this.disconnect(key)
      this.clearStaged(key)
    },

    async connect(apiUrl: string, agentId: string, channel = DEFAULT_CHANNEL) {
      const auth = useAuthStore()
      const c = this.conversation(agentId, channel)
      const key = c.key
      c.apiUrl = apiUrl

      if (c.socket) {
        // A socket the hub dropped (auth rejection) does not reconnect on
        // its own — socket.io treats a server-initiated disconnect as final.
        // Give it the current token and try again.
        if (!c.socket.connected) {
          await auth.ensureFresh()
          c.socket?.connect()
        }
        return
      }

      // Never open the handshake with a token about to expire — the hub
      // would refuse it a moment later.
      await auth.ensureFresh()
      // Someone else connected while the refresh was in flight.
      if (c.socket) return

      const socket = io(`${apiUrl}/ws/client`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
        // `auth` as a function: socket.io calls it on every (re)connect, so
        // a reconnect after a renewal carries the current token, never the
        // one captured when the widget mounted — and the current `lastSeq`,
        // so the hub replays exactly what this conversation has not applied.
        // What this client renders — the hub forwards the list to the agent
        // on every message; the runtime gates thinking-step emission on it.
        // No 'ui': the admin preview doesn't render interactive ui parts.
        auth: (cb) =>
          cb({
            token: useAuthStore().accessToken ?? '',
            agentId,
            capabilities: ['streaming', 'images', 'files', 'thinking'],
            lastSeq: c.lastHubSeq,
          }),
      })

      socket.on('connect', () => {
        c.isConnected = true
        c.authRetried = false
      })

      // The hub refused the handshake token and is about to drop the socket.
      // One refresh + reconnect covers a token that expired while the tab
      // was asleep; if the session itself is gone, say so — the dialog
      // replaces the "Chat reconnecting…" limbo.
      socket.on('bridle_error', async (e: { code?: string; agentId?: string; origin?: string }) => {
        const code = e?.code
        if (code !== 'TOKEN_EXPIRED' && code !== 'INVALID_TOKEN') return
        if (!c.authRetried && (await useAuthStore().refresh())) {
          c.authRetried = true
          // The server's disconnect may land after the refresh round trip
          // or before it; `connect()` is a no-op on a still-open socket.
          const reconnect = () => socket.connect()
          if (socket.connected) socket.once('disconnect', reconnect)
          else reconnect()
        } else {
          useAuthStore().endSession(code)
        }
      })

      socket.on('disconnect', (reason: string) => {
        c.isConnected = false
        // We can't observe agent register/unregister while our own socket is
        // down; reset to false so the indicator doesn't lie about a stale
        // value while we're trying to reconnect.
        c.isAgentConnected = false
        if (reason === 'io client disconnect') {
          // We hung up (unmount, new chat) — nobody is left to watch the turn.
          c.isTyping = false
          this._closeAllTurns(key)
          return
        }
        // A transient drop does NOT end the turn: the agent keeps working and
        // the hub replays what we miss once we are back (`lastSeq`). Closing
        // the turn here is what froze answers the agent's log already had
        // (research F4). The watchdog decides — make sure one is running.
        if (hasOpenTurn(c) && !c.thinkingStaleTimer) this._armThinkingWatchdog(key)
      })

      socket.on('connect_error', (err) => {
        c.isConnected = false
        c.isAgentConnected = false
        console.error('[bridle] connection error:', err.message)
      })

      socket.on('welcome', (data: { clientId: string; seq?: number }) => {
        c.clientId = data.clientId
        // The hub's sequence is BEHIND ours: it restarted and lost its replay
        // buffer. Nothing will be replayed — adopt its numbering and recover
        // what we missed from the transcript instead.
        if (typeof data.seq === 'number' && data.seq < c.lastHubSeq) {
          c.lastHubSeq = data.seq
          void this.loadTranscript(apiUrl, agentId, channel)
        }
      })

      // The hub could not deliver a message — a dead attachment, usually.
      // Reported on its own event rather than by dropping the socket, so the
      // conversation survives one bad file. The message's own state comes
      // from the ack (`rejected / ATTACHMENT_FAILED`).
      socket.on('message_error', (data: { message?: string; seq?: number }) => {
        if (!acceptHubSeq(c, data?.seq)) return
        c.isTyping = false
        c.attachmentError = data?.message ?? 'Message could not be delivered'
      })

      socket.on('agent_status', (data: { connected?: boolean; seq?: number }) => {
        if (!acceptHubSeq(c, data?.seq)) return
        c.isAgentConnected = !!data?.connected
      })

      // Another view of this identity (second tab, a colleague) sent a
      // message: show the question, not only the answer. Our own sends never
      // come back — and if one did, its id is already here.
      socket.on('user_message', (data: {
        messageId?: string
        text?: string
        attachments?: IBridleAttachmentRef[]
        ts?: number
        seq?: number
      }) => {
        if (!acceptHubSeq(c, data?.seq)) return
        const id = data?.messageId
        if (!id || c.messages.some(m => m.id === id)) return
        const text = data.text ?? ''
        const attachments = (data.attachments ?? []).filter(a => !!a?.id && !!a?.name)
        this._push(key, {
          id,
          role: 'user',
          text,
          parts: buildParts(text),
          ts: data.ts ?? Date.now(),
          delivery: 'delivered',
          ...(attachments.length ? { attachments } : {}),
        })
        if (attachments.length) this._hydrateAttachments(apiUrl, agentId, channel, [{ id, attachments }])
      })

      socket.on('message', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number; seq?: number }) => {
        if (!acceptHubSeq(c, data.seq)) return
        c.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        if (!hasVisibleContent(text, parts)) return
        if (data.messageId && c.messages.some(m => m.id === data.messageId)) return
        if (this._isTranscriptContent(key, data.ts)) return
        // Content lands below the open segment — seal it so the next step
        // opens a fresh segment under this message (turn stays open).
        this._freezeOpenThinking(key)
        this._push(key, {
          id: data.messageId ?? crypto.randomUUID(),
          role: 'assistant',
          text,
          parts,
          ts: data.ts ?? Date.now(),
        })
      })

      socket.on('typing', (data?: { seq?: number }) => {
        if (!acceptHubSeq(c, data?.seq)) return
        c.isTyping = true
        this._armThinkingWatchdog(key)
      })

      socket.on('thinking', (e: IBridleThinkingEvent & { seq?: number }) => {
        if (!e?.turnId) return
        if (!acceptHubSeq(c, e.seq)) return
        const turnBlocks = c.thinkingBlocks.filter(b => b.turnId === e.turnId)
        if (e.done || !e.step) {
          // Terminal event — freeze every segment and refuse stragglers.
          for (const b of turnBlocks) this._freezeThinkingBlock(b)
          c.closedTurns[e.turnId] = true
          return
        }
        if (c.closedTurns[e.turnId]) return // straggler after terminal
        // `done` updates land in whichever segment holds the step id — the
        // segment may have sealed while the tool was still running.
        const owner = turnBlocks.find(b => b.steps.some(s => s.id === e.step!.id))
        if (owner) {
          owner.steps = owner.steps.map(s => (s.id === e.step!.id ? e.step! : s))
          c.isTyping = true
          this._armThinkingWatchdog(key)
          return
        }
        // New step: continue the trailing open segment, or open a fresh one
        // below the newest message (segments seal when content lands).
        let block = turnBlocks[turnBlocks.length - 1]
        if (!block || block.status === 'done') {
          // A replayed step of a turn the transcript already shows.
          if (this._isTranscriptContent(key, e.ts)) return
          // Linear conversation: a new turn's first step closes other turns.
          for (const b of c.thinkingBlocks) {
            if (b.turnId !== e.turnId && b.status === 'thinking') {
              this._freezeThinkingBlock(b)
              c.closedTurns[b.turnId] = true
            }
          }
          // Anchored by arrival `seq`, below everything on screen. `ts` is
          // the agent's clock and says nothing about where the block belongs.
          c.thinkingBlocks.push({
            turnId: e.turnId,
            seg: turnBlocks.length,
            steps: [],
            status: 'thinking',
            ts: e.ts ?? Date.now(),
            seq: c.nextSeq++,
          })
          // Re-read through the reactive list: the pushed literal is raw.
          block = c.thinkingBlocks[c.thinkingBlocks.length - 1]!
        }
        block.steps.push(e.step)
        // Steps mean the agent is working — keep the shimmer alive through
        // tool execution and re-arm the watchdog.
        c.isTyping = true
        this._armThinkingWatchdog(key)
      })

      socket.on('stream', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number; seq?: number }) => {
        if (!acceptHubSeq(c, data.seq)) return
        c.isTyping = false
        // Streaming is activity too — keep the stale watchdog fed so the
        // turn is only closed when it truly went silent. Armed even with no
        // open block: a half-streamed bubble is an open turn as well.
        this._armThinkingWatchdog(key)
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = c.messages.findIndex(m => m.id === data.messageId)
        const current = c.messages[idx]
        if (current) {
          c.messages[idx] = { ...current, text, parts, streaming: true }
        } else {
          // Don't create a fresh bubble for an empty initial chunk — wait
          // until the runtime actually has visible content.
          if (!hasVisibleContent(text, parts)) return
          if (this._isTranscriptContent(key, data.ts)) return
          // First visible chunk of a new bubble — seal the open segment so
          // subsequent steps continue below this message.
          this._freezeOpenThinking(key)
          this._push(key, {
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
            streaming: true,
          })
        }
      })

      socket.on('debug', (data: IBridleDebugData & { messageId?: string; seq?: number }) => {
        if (!acceptHubSeq(c, data.seq)) return
        if (data.messageId) {
          c.debugByMessageId[data.messageId] = data
        }
        // Always cache as last — covers the case where runtime didn't pass
        // a messageId so we can still attach to the most recent assistant
        // message via the getter.
        c.lastDebug = data
        // Persist for survival across page reloads. Scoped per bot.
        saveDebugToStorage(agentId, {
          byMessageId: { ...c.debugByMessageId },
          lastDebug: c.lastDebug,
        })
      })

      socket.on('stream_end', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number; seq?: number }) => {
        if (!acceptHubSeq(c, data.seq)) return
        c.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = c.messages.findIndex(m => m.id === data.messageId)
        const current = c.messages[idx]
        if (current) {
          c.messages[idx] = { ...current, text, parts, streaming: false }
        } else {
          if (!hasVisibleContent(text, parts)) return
          if (this._isTranscriptContent(key, data.ts)) return
          this._push(key, {
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
          })
        }
      })

      // Raw on purpose: a socket is not view state, and a reactive proxy
      // around its internals only costs.
      c.socket = markRaw(socket)
    },

    disconnect(key: string) {
      const c = this._conv(key)
      if (!c) return
      c.socket?.disconnect()
      c.socket = null
      c.isConnected = false
      c.isAgentConnected = false
    },

    /**
     * Append with the next arrival `seq`. EVERY append goes through here —
     * `seq` is the only ordering key, so an item without one has no place.
     */
    _push(key: string, message: IBridleMessageData) {
      const c = this._conv(key)
      if (!c) return
      c.messages.push({ ...message, seq: c.nextSeq++ })
      // Something new is on screen — a "turn died" line above it is stale.
      c.notice = null
    },

    /**
     * Agent content stamped at or before the transcript's newest message is
     * already on screen as transcript. It comes back when the hub replays a
     * turn that finished while this chat was closed — under wire ids the
     * transcript does not share, so the id check cannot catch it. Both stamps
     * are the runtime's clock, which is what makes them comparable. INTERIM,
     * same cause as the outbox text match — tasks.md T044.
     */
    _isTranscriptContent(key: string, ts?: number): boolean {
      const c = this._conv(key)
      return !!c && typeof ts === 'number' && ts <= c.transcriptTailTs
    },

    /**
     * Send the draft plus whatever is staged.
     *
     * Only the attachment *ids* go over the wire — the hub reads the stored
     * bytes and expands them into the parts the agent receives, exactly as the
     * HTTP routes do. The parts built here are the local echo: what the person
     * sees in their own bubble, not what the agent is sent.
     *
     * An agent turn in flight does not block this: a follow-up is a message
     * like any other.
     */
    async sendMessage(
      key: string,
      text: string,
      images?: Array<{ base64: string; mediaType: string }>,
    ) {
      const c = this._conv(key)
      if (!c) return
      const trimmed = text.trim()
      const ready = c.staged.filter(
        a => a.state === BridleAttachmentStates.Ready && a.remoteId,
      )
      if (!trimmed && !ready.length) return
      // Refuse rather than silently dropping the file the message is about.
      if (this.isUploadingAttachment(key) || this.hasFailedAttachment(key)) return

      const wireParts = buildParts(trimmed, images)
      const echoParts = buildParts(trimmed, images)

      for (const entry of ready) {
        if (entry.kind === BridleAttachmentKinds.Image) {
          try {
            echoParts.push({
              type: BridlePartTypes.Image,
              base64: await readAsBase64(entry.file),
              mediaType: entry.mimeType,
            })
            continue
          } catch {
            // Unreadable locally for some reason — fall through to a link
            // rather than dropping it from the person's own view.
          }
        }
        const url = URL.createObjectURL(entry.file)
        c.echoUrls.push(url)
        echoParts.push({
          type: BridlePartTypes.File,
          url,
          name: entry.name,
          mimeType: entry.mimeType,
        })
      }

      const attachments: IBridleAttachmentRef[] = ready.map(a => ({
        id: a.remoteId as string,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        kind: a.kind,
      }))

      // One id for the bubble, the wire (`clientMessageId`) and — once the
      // runtime persists it — the transcript (research F7).
      const id = crypto.randomUUID()
      this._push(key, {
        id,
        role: 'user',
        text: trimmed,
        parts: echoParts,
        ts: Date.now(),
        ...nextDelivery({}, { type: 'sent' }),
        ...(attachments.length ? { attachments } : {}),
      })

      // Empty the composer before the round trip so the next message can be
      // typed while the agent thinks.
      this.clearStaged(key)
      this._emitMessage(key, id, wireParts)
    },

    /**
     * Hand one message to the hub and track what becomes of it. Shared by the
     * first send and `resend` — same id both times, so the hub can tell a
     * repeat from a new message.
     */
    _emitMessage(key: string, id: string, wireParts: BridlePart[]) {
      const c = this._conv(key)
      const message = c?.messages.find(m => m.id === id)
      if (!c || !message) return
      this._persistOutbox(key)

      // socket.io BUFFERS an emit on a disconnected socket and sends it on
      // reconnect — whenever that is, with no way to tell the person. Say
      // "not delivered" now and let them decide.
      const socket = c.socket
      if (!socket || !socket.connected) {
        this._applyDelivery(key, id, { type: 'ackRejected', code: 'OFFLINE' })
        return
      }

      c.notice = null
      c.isTyping = true
      // The optimistic shimmer above must not outlive a turn that never starts.
      this._armThinkingWatchdog(key)

      clearSlowTimer(key, id)
      slowTimers.set(
        `${key}|${id}`,
        setTimeout(() => {
          slowTimers.delete(`${key}|${id}`)
          this._applyDelivery(key, id, { type: 'tick', elapsedMs: SLOW_MS })
        }, SLOW_MS),
      )

      const attachmentIds = (message.attachments ?? []).map(a => a.id)
      socket.timeout(FAILED_MS).emit(
        'message',
        {
          text: message.text,
          parts: wireParts,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          clientMessageId: id,
        },
        (err: Error | null, ack?: BridleSendAck) => {
          if (err || !ack) {
            // No answer in 30 s. The message may still have arrived — which
            // is why Resend reuses the id and the hub de-duplicates.
            this._applyDelivery(key, id, { type: 'tick', elapsedMs: FAILED_MS })
            this._settleTypingAfterFailure(key)
            return
          }
          if (ack.status === 'accepted') {
            this._applyDelivery(key, id, { type: 'ackAccepted' })
            // Show the hub's time from here on, so the live view and a later
            // replay agree on when this was sent.
            const sent = this._conv(key)?.messages.find(m => m.id === id)
            if (sent && typeof ack.ts === 'number') sent.ts = ack.ts
            return
          }
          this._applyDelivery(key, id, { type: 'ackRejected', code: ack.code })
          this._settleTypingAfterFailure(key)
        },
      )
    },

    /** Run one delivery event through the state machine (utils/delivery.ts). */
    _applyDelivery(key: string, id: string, event: DeliveryEvent) {
      const message = this._conv(key)?.messages.find(m => m.id === id && m.role === 'user')
      if (!message) return
      const next = nextDelivery(
        { delivery: message.delivery, failureCode: message.failureCode },
        event,
      )
      message.delivery = next.delivery
      message.failureCode = next.failureCode
      if (next.delivery !== 'sending') clearSlowTimer(key, id)
      this._persistOutbox(key)
    },

    /**
     * The message did not go through, so nothing will answer it. Drop the
     * optimistic shimmer — unless a turn is visibly running (a follow-up that
     * failed must not hide the answer still being written).
     */
    _settleTypingAfterFailure(key: string) {
      const c = this._conv(key)
      if (!c) return
      if (c.thinkingBlocks.some(b => b.status === 'thinking') || c.messages.some(m => m.streaming)) return
      c.isTyping = false
      if (c.thinkingStaleTimer) {
        clearTimeout(c.thinkingStaleTimer)
        c.thinkingStaleTimer = null
      }
    },

    /** Try a failed message again — SAME id, so it can never arrive twice. */
    resend(key: string, id: string) {
      const message = this._conv(key)?.messages.find(m => m.id === id && m.role === 'user')
      if (!message || message.delivery !== 'failed') return
      this._applyDelivery(key, id, { type: 'resend' })
      this._emitMessage(key, id, buildParts(message.text))
    },

    /** Drop a failed message from the conversation and the outbox. */
    discard(key: string, id: string) {
      const c = this._conv(key)
      if (!c) return
      const index = c.messages.findIndex(
        m => m.id === id && m.role === 'user' && m.delivery === 'failed',
      )
      if (index < 0) return
      c.messages.splice(index, 1)
      clearSlowTimer(key, id)
      this._persistOutbox(key)
    },

    /** Mirror the not-delivered messages of this conversation into storage. */
    _persistOutbox(key: string) {
      const c = this._conv(key)
      if (!c) return
      saveOutbox(
        key,
        c.messages
          .filter(m => m.role === 'user' && !!m.delivery && m.delivery !== 'delivered')
          .map(m => ({
            id: m.id,
            text: m.text,
            ts: m.ts,
            delivery: m.delivery as BridleDelivery,
            ...(m.failureCode ? { failureCode: m.failureCode } : {}),
            // References only — the echo's image bytes stay out of storage.
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
          })),
      )
    },

    // ── Attachments ──────────────────────────

    /**
     * Validate against the client mirror of the API's limits. Returns the
     * sentence to show, or null when the file is fine.
     */
    _rejectReason(key: string, file: File, pendingBytes: number): string | null {
      const staged = this._conv(key)?.staged ?? []
      if (staged.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        return `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files`
      }
      if (file.size === 0) return `${file.name} is empty`
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return `${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}`
      }
      if (pendingBytes + file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
        return `Those files add up to more than ${formatBytes(MAX_MESSAGE_ATTACHMENT_BYTES)} in one message`
      }
      return null
    },

    /**
     * Stage a selection and start uploading each accepted file. A rejected
     * file never blocks the acceptable ones beside it — picking five where one
     * is a .zip stages four.
     */
    stageFiles(
      key: string,
      apiUrl: string,
      files: File[] | FileList,
    ) {
      const c = this._conv(key)
      if (!c) return
      const list = Array.from(files)
      if (!list.length) return
      c.attachmentError = null

      let pendingBytes = c.staged.reduce((sum, a) => sum + a.size, 0)

      for (const file of list) {
        const mimeType = resolveMimeType(file)
        const problem = !isAllowedMimeType(mimeType)
          ? `${file.name} is not a supported file type. Try an image, a PDF, an Office document, or a text file.`
          : this._rejectReason(key, file, pendingBytes)

        if (problem) {
          c.attachmentError = problem
          continue
        }

        const kind = resolveKind(mimeType)
        const staging: IStagedAttachment = {
          localId: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          size: file.size,
          mimeType,
          kind,
          previewUrl:
            kind === BridleAttachmentKinds.Image
              ? URL.createObjectURL(file)
              : null,
          state: BridleAttachmentStates.Uploading,
          progress: 0,
          remoteId: null,
          error: null,
        }

        c.staged.push(staging)
        pendingBytes += file.size
        void this.uploadStaged(key, apiUrl, staging.localId)
      }
    },

    async uploadStaged(
      key: string,
      apiUrl: string,
      localId: string,
    ) {
      const c = this._conv(key)
      if (!c) return
      const find = () => c.staged.find(a => a.localId === localId)
      const entry = find()
      if (!entry) return

      entry.state = BridleAttachmentStates.Uploading
      entry.progress = 0
      entry.error = null

      try {
        const stored = await uploadAttachment(
          apiUrl,
          c.agentId,
          entry.file,
          (percent) => {
            // The chip may have been removed mid-flight.
            const live = find()
            if (live) live.progress = percent
          },
        )
        const live = find()
        if (!live) return
        live.remoteId = stored.id
        // The server holds the bytes and decides the real kind — a .txt full
        // of undecodable bytes comes back as `binary`.
        live.kind = stored.kind
        live.mimeType = stored.mimeType
        live.progress = 100
        live.state = BridleAttachmentStates.Ready
      } catch (err) {
        const live = find()
        if (!live) return
        // Recorded against this file only: the draft and every other staged
        // file are untouched. Losing a written message because one upload
        // broke is the worst outcome here.
        live.state = BridleAttachmentStates.Failed
        live.error = (err as Error).message || 'Upload failed'
        console.warn('[bridle] attachment upload failed', err)
      }
    },

    retryStaged(
      key: string,
      apiUrl: string,
      localId: string,
    ) {
      const entry = this._conv(key)?.staged.find(a => a.localId === localId)
      if (!entry || entry.state === BridleAttachmentStates.Uploading) return
      void this.uploadStaged(key, apiUrl, localId)
    },

    removeStaged(key: string, localId: string) {
      const c = this._conv(key)
      if (!c) return
      const index = c.staged.findIndex(a => a.localId === localId)
      if (index < 0) return
      const [entry] = c.staged.splice(index, 1)
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl)
      c.attachmentError = null
    },

    clearStaged(key: string) {
      const c = this._conv(key)
      if (!c) return
      for (const entry of c.staged) {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
      }
      c.staged = []
      c.attachmentError = null
    },

    dismissAttachmentError(key: string) {
      const c = this._conv(key)
      if (c) c.attachmentError = null
    },

    /** Empty this conversation's view. The outbox in storage is untouched. */
    clearMessages(key: string) {
      const c = this._conv(key)
      if (!c) return
      for (const url of c.echoUrls) URL.revokeObjectURL(url)
      c.echoUrls = []
      c.messages = []
      c.nextSeq = 1
      c.transcriptTailTs = 0
      c.transcriptCursor = null
      c.hasMoreOlder = false
      c.debugByMessageId = {}
      c.lastDebug = null
      c.thinkingBlocks = []
      c.closedTurns = {}
      c.isTyping = false
      c.notice = null
      if (c.thinkingStaleTimer) {
        clearTimeout(c.thinkingStaleTimer)
        c.thinkingStaleTimer = null
      }
    },

    // ── Thinking helpers ─────────────────────────────────────────────

    _freezeThinkingBlock(block: IThinkingBlock) {
      block.status = 'done'
      block.steps = block.steps.map(s => ({ ...s, state: 'done' as const }))
    },

    /**
     * Seal (collapse) every open segment. The turns stay open — later steps
     * of the same turn open a fresh segment below the newest message.
     */
    _freezeOpenThinking(key: string) {
      for (const b of this._conv(key)?.thinkingBlocks ?? []) {
        if (b.status === 'thinking') this._freezeThinkingBlock(b)
      }
    },

    /** Terminal paths (watchdog, deliberate disconnect): seal segments AND
     * close their turns so straggler steps can't resurrect a zombie segment. */
    _closeAllTurns(key: string) {
      const c = this._conv(key)
      if (!c) return
      for (const b of c.thinkingBlocks) c.closedTurns[b.turnId] = true
      this._freezeOpenThinking(key)
    },

    /**
     * A cancelled runtime turn never emits stream_end/message or the
     * terminal thinking event — without this watchdog the shimmer would
     * animate forever. Re-armed by every typing/thinking/stream event.
     */
    _armThinkingWatchdog(key: string) {
      const c = this._conv(key)
      if (!c) return
      if (c.thinkingStaleTimer) clearTimeout(c.thinkingStaleTimer)
      c.thinkingStaleTimer = setTimeout(() => {
        c.thinkingStaleTimer = null
        void this._onTurnStale(key)
      }, TURN_STALE_MS)
    },

    /**
     * The watchdog ran out. If a turn was still open, the answer may exist
     * all the same — finished while we were offline for longer than the hub's
     * replay buffer covers. The transcript is the safety net: take assistant
     * messages newer than the last one on screen; if there are none, say the
     * turn died instead of quietly hiding the shimmer.
     */
    async _onTurnStale(key: string) {
      const c = this._conv(key)
      if (!c) return
      const wasOpen = hasOpenTurn(c)
      c.isTyping = false
      this._closeAllTurns(key)
      // A half-streamed bubble will get no more chunks.
      for (const m of c.messages) {
        if (m.streaming) m.streaming = false
      }
      if (!wasOpen) return

      let page: ITranscriptPage | null = null
      try {
        if (c.apiUrl) page = await fetchTranscriptPage(c.apiUrl, c.agentId, c.channel)
      } catch (err) {
        console.warn('[bridle] failed to fetch transcript after a stale turn', err)
      }

      const shown = c.messages.filter(m => m.role === 'assistant')
      const lastShownTs = shown[shown.length - 1]?.ts ?? 0
      // What this session already shows of the running turn. The runtime
      // saves a turn as ONE event with its pieces joined (research F6), so
      // the saved copy of bubbles we already have is their concatenation.
      const lastUserIndex = c.messages.map(m => m.role).lastIndexOf('user')
      const turnText = c.messages
        .slice(lastUserIndex + 1)
        .filter(m => m.role === 'assistant')
        .map(m => m.text)
        .join('')
      const missed = (page?.messages ?? []).filter(
        t =>
          t.role === 'assistant' &&
          t.ts > lastShownTs &&
          t.text !== turnText &&
          !c.messages.some(m => m.id === t.id || (m.role === 'assistant' && m.text === t.text)),
      )
      // A turn that came alive again while we were fetching needs no verdict.
      if (hasOpenTurn(c)) return
      if (!missed.length) {
        c.notice = TURN_DIED_NOTICE
        return
      }
      for (const t of missed) this._push(key, toBridleMessage(t))
      c.transcriptTailTs = Math.max(c.transcriptTailTs, ...missed.map(t => t.ts))
      if (c.apiUrl) this._hydrateAttachments(c.apiUrl, c.agentId, c.channel, missed)
    },

    async loadAgentMeta(apiUrl: string, agentId: string, channel = DEFAULT_CHANNEL): Promise<void> {
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}`
      try {
        const res = await authedFetch(url)
        if (!res.ok) return
        type AgentMeta = { debugEnabled?: boolean }
        type Envelope = { data?: AgentMeta }
        const body = (await res.json()) as Envelope & AgentMeta
        this.conversation(agentId, channel).debugEnabled = !!(body.data?.debugEnabled ?? body.debugEnabled)
      } catch (err) {
        console.warn('[bridle] failed to load agent meta', err)
      }
    },

    async setDebugEnabled(
      apiUrl: string,
      agentId: string,
      enabled: boolean,
      channel = DEFAULT_CHANNEL,
    ): Promise<boolean> {
      // Debug is persisted through the regular agent-update endpoint
      // (PUT /agents/:id). The API still pushes the live prompt-debug control
      // event over the bridle WS when `debugEnabled` is in the payload.
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}`
      try {
        const res = await authedFetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debugEnabled: enabled }),
        })
        if (!res.ok) {
          console.warn('[bridle] setDebugEnabled returned', res.status)
          return false
        }
        // PUT returns the full agent — trust the server's echo over the
        // optimistic value to avoid drift.
        type Resp = { debugEnabled?: boolean }
        type Envelope = { data?: Resp }
        const body = (await res.json()) as Envelope & Resp
        const next = body.data?.debugEnabled ?? body.debugEnabled ?? enabled
        this.conversation(agentId, channel).debugEnabled = next
        return next
      } catch (err) {
        console.warn('[bridle] failed to set debug flag', err)
        return false
      }
    },

    async resetTranscript(apiUrl: string, agentId: string, channel = DEFAULT_CHANNEL) {
      const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?channel=${encodeURIComponent(channel)}`
      try {
        const res = await authedFetch(url, { method: 'DELETE' })
        if (!res.ok) {
          console.warn('[bridle] transcript reset returned', res.status)
          return false
        }
        const c = this.conversation(agentId, channel)
        for (const url of c.echoUrls) URL.revokeObjectURL(url)
        c.echoUrls = []
        c.messages = []
        c.nextSeq = 1
        c.transcriptTailTs = 0
        c.transcriptCursor = null
        c.hasMoreOlder = false
        c.debugByMessageId = {}
        c.lastDebug = null
        c.thinkingBlocks = []
        c.closedTurns = {}
        c.notice = null
        clearDebugFromStorage(agentId)
        // A new chat starts clean: undelivered leftovers of the old one go too.
        saveOutbox(c.key, [])
        return true
      } catch (err) {
        console.warn('[bridle] failed to reset transcript', err)
        return false
      }
    },

    /**
     * Hydrate debug snapshots for the given bot from localStorage. Called from
     * the Provider on mount so the inspect icon survives a page refresh.
     */
    loadPersistedDebug(agentId: string, channel = DEFAULT_CHANNEL): void {
      const stored = loadDebugFromStorage(agentId)
      if (!stored) return
      const c = this.conversation(agentId, channel)
      // Merged under what this session already holds: the record outlives a
      // provider, and a snapshot received live is newer than the stored one.
      c.debugByMessageId = { ...(stored.byMessageId ?? {}), ...c.debugByMessageId }
      c.lastDebug = c.lastDebug ?? stored.lastDebug ?? null
    },

    /**
     * Load the newest transcript page and MERGE it into the conversation.
     *
     * It used to replace the list, which wiped whatever had been appended
     * locally (research F3). Now the transcript is the authority for what it
     * holds, and everything it does not hold yet stays, below it: the outbox
     * (not-delivered messages, also from a previous page load) and this
     * session's live items the runtime has not saved yet.
     */
    async loadTranscript(apiUrl: string, agentId: string, channel = DEFAULT_CHANNEL) {
      const c = this.conversation(agentId, channel)
      let page: ITranscriptPage | null = null
      try {
        page = await fetchTranscriptPage(apiUrl, agentId, channel)
      } catch (err) {
        console.warn('[bridle] failed to load transcript', err)
      }

      // Outbox entries that are not in memory were written by a previous page.
      // Whatever was still in flight then can no longer be acknowledged.
      const known = new Set(c.messages.map(m => m.id))
      const restored: IBridleMessageData[] = loadOutbox(c.key)
        .filter(e => !known.has(e.id))
        .map(e => ({
          id: e.id,
          role: 'user' as const,
          text: e.text,
          parts: buildParts(e.text),
          ts: e.ts,
          ...nextDelivery(
            { delivery: e.delivery, failureCode: e.failureCode },
            { type: 'pageLoad' },
          ),
          ...(e.attachments?.length ? { attachments: e.attachments } : {}),
        }))

      const local = [...c.messages, ...restored]
      const source = page?.messages ?? []
      const tailTs = source.reduce((max, m) => Math.max(max, m.ts), 0)
      // Without a page (fetch failed) nothing on screen is contradicted.
      const kept = !page
        ? local
        : local.filter((m) => {
            if (m.replayed) return false
            if (m.role === 'assistant') {
              // Same clock as the transcript: newer than its tail means the
              // runtime has not saved it yet (it saves at the end of a turn).
              return !!m.streaming || m.ts > tailTs
            }
            if (isInTranscript(m, source)) return false
            const pending = !!m.delivery && m.delivery !== 'delivered'
            // A delivered message the page does not show is further back
            // than the page reaches — it belongs to an older page, not here.
            return pending || m.ts >= tailTs - PERSISTED_MATCH_WINDOW_MS
          })

      // Thinking segments are session-only. Keep the ones that sit below the
      // last local item the transcript took over; the rest belonged to turns
      // that are plain transcript now.
      const keptIds = new Set(kept.map(m => m.id))
      const cutSeq = local.reduce(
        (max, m) => (!keptIds.has(m.id) && typeof m.seq === 'number' ? Math.max(max, m.seq) : max),
        Number.NEGATIVE_INFINITY,
      )
      const blocks = c.thinkingBlocks.filter(
        b => b.status === 'thinking' || (b.seq ?? 0) > cutSeq,
      )

      // Transcript first, in the order returned, numbered from 1 — then the
      // local tail in the order it happened (restored entries have no `seq`
      // yet and go last).
      const transcript = page ? numberLegacy(source.map(toBridleMessage)) : []
      let seq = nextSeq(transcript)
      const order = (s?: number) => s ?? Number.MAX_SAFE_INTEGER
      const tail = [
        ...kept.map(m => ({ seq: m.seq, message: m, block: null as IThinkingBlock | null })),
        ...blocks.map(b => ({ seq: b.seq, message: null as IBridleMessageData | null, block: b })),
      ].sort((a, b) => order(a.seq) - order(b.seq))
      const messages: IBridleMessageData[] = [...transcript]
      for (const item of tail) {
        if (item.block) item.block.seq = seq++
        else if (item.message) messages.push({ ...item.message, seq: seq++ })
      }

      c.messages = messages
      c.thinkingBlocks = blocks
      c.nextSeq = seq
      if (page) {
        c.transcriptTailTs = tailTs
        c.transcriptCursor = page.nextCursor
        c.hasMoreOlder = page.hasMore
      }
      this._persistOutbox(c.key)
      this._hydrateAttachments(apiUrl, agentId, channel, [
        ...source,
        // A restored message lost its echo with the page — rebuild the chips
        // from the references it kept.
        ...restored.map(m => ({ id: m.id, attachments: m.attachments })),
      ])
    },

    /**
     * Turn a replayed message's attachment references back into renderable
     * parts. Bytes are fetched through the guarded download route (an <img>
     * or plain <a> cannot carry the bearer): images become base64 image
     * parts — the exact shape the live echo uses, lightbox included — and
     * everything else becomes an object-URL file chip. Fire-and-forget per
     * message; a missing file degrades to a dead chip, its siblings and the
     * rest of the transcript are untouched.
     */
    _hydrateAttachments(
      apiUrl: string,
      agentId: string,
      channel: string,
      source: Array<{ id: string; attachments?: ITranscriptAttachment[] }>,
    ) {
      const base = apiUrl.replace(/\/$/, '')
      const key = bridleKey(agentId, channel)
      for (const m of source) {
        const attachments = m.attachments
        if (!attachments?.length) continue
        void (async () => {
          const parts: BridlePart[] = []
          for (const att of attachments) {
            try {
              const res = await authedFetch(
                `${base}/api/agent/${encodeURIComponent(agentId)}/attachment/${encodeURIComponent(att.id)}`,
              )
              if (!res.ok) throw new Error(`attachment fetch ${res.status}`)
              const blob = await res.blob()
              if (att.kind === BridleAttachmentKinds.Image) {
                parts.push({
                  type: BridlePartTypes.Image,
                  base64: await readAsBase64(blob),
                  mediaType: att.mimeType,
                })
              } else {
                const url = URL.createObjectURL(blob)
                this._conv(key)?.echoUrls.push(url)
                parts.push({
                  type: BridlePartTypes.File,
                  url,
                  name: att.name,
                  mimeType: att.mimeType,
                })
              }
            } catch {
              // The stored object is gone (agent wiped) or unreachable —
              // an url-less chip renders as "no longer available".
              parts.push({
                type: BridlePartTypes.File,
                url: '',
                name: att.name,
                mimeType: att.mimeType,
              })
            }
          }
          // Looked up at completion on purpose: if the transcript was
          // cleared or reloaded while bytes were in flight, the id is gone
          // and the late result is dropped instead of resurrecting a bubble.
          const target = this._conv(key)?.messages.find((x) => x.id === m.id)
          if (!target) return
          // A second load of the same page must not stack the media twice.
          const text = target.parts.filter(p => p.type === BridlePartTypes.Text)
          // Media above the text, the way every chat client orders it.
          target.parts = [...parts, ...text]
        })()
      }
    },

    /**
     * Prepend the next older page of messages to `messages`. No-op when there
     * are no more older messages or a load is already in flight. Returns the
     * count of newly-prepended messages so the caller can preserve scroll
     * position relative to the previous top.
     */
    async loadOlderTranscript(
      apiUrl: string,
      agentId: string,
      channel = DEFAULT_CHANNEL,
    ): Promise<number> {
      const c = this.conversation(agentId, channel)
      if (c.loadingOlder || !c.hasMoreOlder || !c.transcriptCursor) {
        return 0
      }
      c.loadingOlder = true
      try {
        const page = await fetchTranscriptPage(
          apiUrl,
          agentId,
          channel,
          c.transcriptCursor,
        )
        if (!page) return 0
        const known = new Set(c.messages.map(m => m.id))
        const fresh = page.messages.filter(m => !known.has(m.id))
        // Numbered BELOW the current minimum, so everything already on screen
        // keeps its `seq` — and with it its place and its render key.
        const floor = c.messages.reduce((min, m) => Math.min(min, m.seq ?? min), 1)
        const olderMessages = fresh.map((m, i) => ({
          ...toBridleMessage(m),
          seq: floor - fresh.length + i,
        }))
        c.messages = [...olderMessages, ...c.messages]
        c.transcriptCursor = page.nextCursor
        c.hasMoreOlder = page.hasMore
        this._hydrateAttachments(apiUrl, agentId, channel, fresh)
        return olderMessages.length
      } catch (err) {
        console.warn('[bridle] failed to load older transcript', err)
        return 0
      } finally {
        c.loadingOlder = false
      }
    },

    setMarkdownEnabled(enabled: boolean) {
      this.markdownEnabled = enabled
      saveMarkdownPref(enabled)
    },

    toggle() {
      this.isOpen = !this.isOpen
    },

    open() {
      this.isOpen = true
    },

    close() {
      this.isOpen = false
    },
  },
})
