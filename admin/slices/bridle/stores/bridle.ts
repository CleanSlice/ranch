import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'

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

export interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  streaming?: boolean
}

// ── Thinking (live reasoning steps) ──────────────────────────
// Mirrors the wire contract in api/src/slices/bridle/domain/bridle.types.ts.

export interface IBridleThinkingStep {
  id: string
  label: string
  detail?: string
  state: 'active' | 'done'
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

interface ITranscriptPageMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
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
 */
async function fetchTranscriptPage(
  apiUrl: string,
  agentId: string,
  token: string,
  channel: string,
  cursor?: string,
): Promise<ITranscriptPage | null> {
  const params = new URLSearchParams({ channel })
  params.set('limit', String(TRANSCRIPT_PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?${params.toString()}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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

function toBridleMessage(m: ITranscriptPageMessage): IBridleMessageData {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    parts: [{ type: BridlePartTypes.Text as const, text: m.text }],
    ts: m.ts,
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

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    messages: [] as IBridleMessageData[],
    /**
     * Opaque cursor returned by the API for fetching older messages. `null`
     * means there are no more older messages to load (or transcript hasn't
     * been fetched yet — `hasMoreOlder` distinguishes those).
     */
    transcriptCursor: null as string | null,
    hasMoreOlder: false,
    loadingOlder: false,
    isConnected: false,
    /**
     * Whether the agent runtime is currently registered with the bridle hub.
     * Pushed by the hub via the `agent_status` event on connect and on every
     * runtime register/unregister. Independent of `isConnected` (the client's
     * own WS) — the chat header needs both signals to color the indicator.
     */
    isAgentConnected: false,
    isTyping: false,
    isOpen: false,
    clientId: null as string | null,
    /**
     * Live thinking timelines, one per agent turn — opened by the first
     * `thinking` event, frozen by its terminal `done` event (or when the
     * socket drops / the stale watchdog fires). Session-only.
     */
    thinkingBlocks: [] as IThinkingBlock[],
    _thinkingStaleTimer: null as ReturnType<typeof setTimeout> | null,
    /** Turns terminally closed (done event / watchdog / disconnect) —
     * straggler steps for these must not resurrect a segment. */
    _closedTurns: {} as Record<string, true>,
    /**
     * Debug snapshots keyed by messageId when the runtime supplies one;
     * otherwise stored in `_lastDebug` and attached to the most recent
     * assistant message via `getDebugForMessage`.
     */
    debugByMessageId: {} as Record<string, IBridleDebugData>,
    _lastDebug: null as IBridleDebugData | null,
    /**
     * Local mirror of the agent's `debugEnabled` flag, populated by
     * `loadAgentMeta`. UI reads this to render the toggle state. Persistent
     * source of truth lives on the API; runtime gets it via WS push.
     */
    debugEnabled: false,
    /**
     * Render assistant messages as markdown when true; otherwise show raw
     * text. Persisted in localStorage so the user's choice survives refresh.
     */
    markdownEnabled: loadMarkdownPref(),
    _socket: null as Socket | null,
    /** Active agentId — captured on connect, used to scope persisted debug. */
    _agentId: null as string | null,
  }),

  getters: {
    getMessages: (state) => state.messages,
    getIsOpen: (state) => state.isOpen,
    getDebugForMessage: (state) => (id: string): IBridleDebugData | null => {
      const direct = state.debugByMessageId[id]
      if (direct) return direct
      // No messageId match: only attach the orphan debug to the *latest*
      // assistant message — older assistant messages keep no debug.
      const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant && lastAssistant.id === id) return state._lastDebug
      return null
    },
  },

  actions: {
    connect(apiUrl: string, agentId: string, token: string) {
      if (this._socket) return

      this._agentId = agentId

      const socket = io(`${apiUrl}/ws/client`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
        // What this client renders — the hub forwards the list to the agent
        // on every message; the runtime gates thinking-step emission on it.
        // No 'ui': the admin preview doesn't render interactive ui parts.
        auth: { token, agentId, capabilities: ['streaming', 'images', 'files', 'thinking'] },
      })

      socket.on('connect', () => {
        this.isConnected = true
      })

      socket.on('disconnect', () => {
        this.isConnected = false
        // We can't observe agent register/unregister while our own socket is
        // down; reset to false so the indicator doesn't lie about a stale
        // value while we're trying to reconnect.
        this.isAgentConnected = false
        // Nothing can finish an in-flight turn on a dead socket.
        this.isTyping = false
        this._closeAllTurns()
      })

      socket.on('connect_error', (err) => {
        this.isConnected = false
        this.isAgentConnected = false
        console.error('[bridle] connection error:', err.message)
      })

      socket.on('welcome', (data: { clientId: string }) => {
        this.clientId = data.clientId
      })

      socket.on('agent_status', (data: { connected?: boolean }) => {
        this.isAgentConnected = !!data?.connected
      })

      socket.on('message', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        if (!hasVisibleContent(text, parts)) return
        // Content lands below the open segment — seal it so the next step
        // opens a fresh segment under this message (turn stays open).
        this._freezeOpenThinking()
        this.messages.push({
          id: data.messageId ?? crypto.randomUUID(),
          role: 'assistant',
          text,
          parts,
          ts: data.ts ?? Date.now(),
        })
      })

      socket.on('typing', () => {
        this.isTyping = true
        this._armThinkingWatchdog()
      })

      socket.on('thinking', (e: IBridleThinkingEvent) => {
        if (!e?.turnId) return
        const turnBlocks = this.thinkingBlocks.filter(b => b.turnId === e.turnId)
        if (e.done || !e.step) {
          // Terminal event — freeze every segment and refuse stragglers.
          for (const b of turnBlocks) this._freezeThinkingBlock(b)
          this._closedTurns[e.turnId] = true
          return
        }
        if (this._closedTurns[e.turnId]) return // straggler after terminal
        // `done` updates land in whichever segment holds the step id — the
        // segment may have sealed while the tool was still running.
        const owner = turnBlocks.find(b => b.steps.some(s => s.id === e.step!.id))
        if (owner) {
          owner.steps = owner.steps.map(s => (s.id === e.step!.id ? e.step! : s))
          this.isTyping = true
          this._armThinkingWatchdog()
          return
        }
        // New step: continue the trailing open segment, or open a fresh one
        // below the newest message (segments seal when content lands).
        let block = turnBlocks[turnBlocks.length - 1]
        if (!block || block.status === 'done') {
          // Linear conversation: a new turn's first step closes other turns.
          for (const b of this.thinkingBlocks) {
            if (b.turnId !== e.turnId && b.status === 'thinking') {
              this._freezeThinkingBlock(b)
              this._closedTurns[b.turnId] = true
            }
          }
          // Anchor after every message on screen — wire ts is agent-clock.
          const lastTs = this.messages[this.messages.length - 1]?.ts ?? 0
          block = {
            turnId: e.turnId,
            seg: turnBlocks.length,
            steps: [],
            status: 'thinking',
            ts: Math.max(e.ts ?? Date.now(), lastTs + 1),
          }
          this.thinkingBlocks.push(block)
        }
        block.steps.push(e.step)
        // Steps mean the agent is working — keep the shimmer alive through
        // tool execution and re-arm the watchdog.
        this.isTyping = true
        this._armThinkingWatchdog()
      })

      socket.on('stream', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        // Streaming is activity too — keep the stale watchdog fed so an
        // open block only freezes when the turn truly went silent.
        if (this.thinkingBlocks.some(b => b.status === 'thinking')) this._armThinkingWatchdog()
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        const current = this.messages[idx]
        if (current) {
          this.messages[idx] = { ...current, text, parts, streaming: true }
        } else {
          // Don't create a fresh bubble for an empty initial chunk — wait
          // until the runtime actually has visible content.
          if (!hasVisibleContent(text, parts)) return
          // First visible chunk of a new bubble — seal the open segment so
          // subsequent steps continue below this message.
          this._freezeOpenThinking()
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
            streaming: true,
          })
        }
      })

      socket.on('debug', (data: IBridleDebugData & { messageId?: string }) => {
        if (data.messageId) {
          this.debugByMessageId[data.messageId] = data
        }
        // Always cache as last — covers the case where runtime didn't pass
        // a messageId so we can still attach to the most recent assistant
        // message via the getter.
        this._lastDebug = data
        // Persist for survival across page reloads. Scoped per bot.
        if (this._agentId) {
          saveDebugToStorage(this._agentId, {
            byMessageId: { ...this.debugByMessageId },
            lastDebug: this._lastDebug,
          })
        }
      })

      socket.on('stream_end', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        const current = this.messages[idx]
        if (current) {
          this.messages[idx] = { ...current, text, parts, streaming: false }
        } else {
          if (!hasVisibleContent(text, parts)) return
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
          })
        }
      })

      this._socket = socket
    },

    disconnect() {
      this._socket?.disconnect()
      this._socket = null
      this.isConnected = false
      this.isAgentConnected = false
    },

    sendMessage(text: string, images?: Array<{ base64: string; mediaType: string }>) {
      if (!text.trim()) return

      const parts = buildParts(text.trim(), images)

      this.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: text.trim(),
        parts,
        ts: Date.now(),
      })

      this.isTyping = true

      this._socket?.emit('message', { text: text.trim(), parts })
    },

    clearMessages() {
      this.messages = []
      this.transcriptCursor = null
      this.hasMoreOlder = false
      this.debugByMessageId = {}
      this._lastDebug = null
      this.thinkingBlocks = []
      this._closedTurns = {}
      this.isTyping = false
      if (this._thinkingStaleTimer) {
        clearTimeout(this._thinkingStaleTimer)
        this._thinkingStaleTimer = null
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
    _freezeOpenThinking() {
      for (const b of this.thinkingBlocks) {
        if (b.status === 'thinking') this._freezeThinkingBlock(b)
      }
    },

    /** Terminal paths (watchdog, disconnect): seal segments AND close their
     * turns so straggler steps can't resurrect a zombie segment. */
    _closeAllTurns() {
      for (const b of this.thinkingBlocks) this._closedTurns[b.turnId] = true
      this._freezeOpenThinking()
    },

    /**
     * A cancelled runtime turn never emits stream_end/message or the
     * terminal thinking event — without this watchdog the shimmer would
     * animate forever. Re-armed by every typing/thinking/stream event.
     */
    _armThinkingWatchdog() {
      if (this._thinkingStaleTimer) clearTimeout(this._thinkingStaleTimer)
      this._thinkingStaleTimer = setTimeout(() => {
        this._thinkingStaleTimer = null
        this.isTyping = false
        this._closeAllTurns()
      }, 75_000)
    },

    async loadAgentMeta(apiUrl: string, agentId: string, token: string): Promise<void> {
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}`
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        type AgentMeta = { debugEnabled?: boolean }
        type Envelope = { data?: AgentMeta }
        const body = (await res.json()) as Envelope & AgentMeta
        this.debugEnabled = !!(body.data?.debugEnabled ?? body.debugEnabled)
      } catch (err) {
        console.warn('[bridle] failed to load agent meta', err)
      }
    },

    async setDebugEnabled(apiUrl: string, agentId: string, token: string, enabled: boolean): Promise<boolean> {
      // Debug is persisted through the regular agent-update endpoint
      // (PUT /agents/:id). The API still pushes the live prompt-debug control
      // event over the bridle WS when `debugEnabled` is in the payload.
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}`
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
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
        this.debugEnabled = next
        return next
      } catch (err) {
        console.warn('[bridle] failed to set debug flag', err)
        return false
      }
    },

    async resetTranscript(apiUrl: string, agentId: string, token: string, channel = 'admin') {
      const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?channel=${encodeURIComponent(channel)}`
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          console.warn('[bridle] transcript reset returned', res.status)
          return false
        }
        this.messages = []
        this.transcriptCursor = null
        this.hasMoreOlder = false
        this.debugByMessageId = {}
        this._lastDebug = null
        clearDebugFromStorage(agentId)
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
    loadPersistedDebug(agentId: string): void {
      const stored = loadDebugFromStorage(agentId)
      if (!stored) return
      this.debugByMessageId = stored.byMessageId ?? {}
      this._lastDebug = stored.lastDebug ?? null
    },

    async loadTranscript(apiUrl: string, agentId: string, token: string, channel = 'admin') {
      try {
        const page = await fetchTranscriptPage(apiUrl, agentId, token, channel)
        if (!page) return
        this.messages = page.messages.map(toBridleMessage)
        this.transcriptCursor = page.nextCursor
        this.hasMoreOlder = page.hasMore
      } catch (err) {
        console.warn('[bridle] failed to load transcript', err)
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
      token: string,
      channel = 'admin',
    ): Promise<number> {
      if (this.loadingOlder || !this.hasMoreOlder || !this.transcriptCursor) {
        return 0
      }
      this.loadingOlder = true
      try {
        const page = await fetchTranscriptPage(
          apiUrl,
          agentId,
          token,
          channel,
          this.transcriptCursor,
        )
        if (!page) return 0
        const olderMessages = page.messages.map(toBridleMessage)
        this.messages = [...olderMessages, ...this.messages]
        this.transcriptCursor = page.nextCursor
        this.hasMoreOlder = page.hasMore
        return olderMessages.length
      } catch (err) {
        console.warn('[bridle] failed to load older transcript', err)
        return 0
      } finally {
        this.loadingOlder = false
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
