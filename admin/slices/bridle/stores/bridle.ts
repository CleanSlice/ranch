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

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    messages: [] as IBridleMessageData[],
    isConnected: false,
    isTyping: false,
    isOpen: false,
    clientId: null as string | null,
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
    _socket: null as Socket | null,
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
    connect(apiUrl: string, botId: string, token: string) {
      if (this._socket) return

      const socket = io(`${apiUrl}/ws/chat`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
        auth: { token, botId },
      })

      socket.on('connect', () => {
        this.isConnected = true
      })

      socket.on('disconnect', () => {
        this.isConnected = false
      })

      socket.on('connect_error', (err) => {
        this.isConnected = false
        console.error('[bridle] connection error:', err.message)
      })

      socket.on('welcome', (data: { clientId: string }) => {
        this.clientId = data.clientId
      })

      socket.on('message', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
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
      })

      socket.on('stream', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text, parts, streaming: true }
        } else {
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
      })

      socket.on('stream_end', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text, parts, streaming: false }
        } else {
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
      this.debugByMessageId = {}
      this._lastDebug = null
    },

    async loadAgentMeta(apiUrl: string, botId: string, token: string): Promise<void> {
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(botId)}`
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

    async setDebugEnabled(apiUrl: string, botId: string, token: string, enabled: boolean): Promise<boolean> {
      const url = `${apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(botId)}/debug`
      try {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ enabled }),
        })
        if (!res.ok) {
          console.warn('[bridle] setDebugEnabled returned', res.status)
          return false
        }
        // The endpoint returns { id, debugEnabled } — we trust the server's
        // echo over the optimistic value to avoid drift.
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

    async resetTranscript(apiUrl: string, botId: string, token: string, channel = 'admin') {
      const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(botId)}/transcript?channel=${encodeURIComponent(channel)}`
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
        return true
      } catch (err) {
        console.warn('[bridle] failed to reset transcript', err)
        return false
      }
    },

    async loadTranscript(apiUrl: string, botId: string, token: string, channel = 'admin') {
      try {
        const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(botId)}/transcript?channel=${encodeURIComponent(channel)}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          console.warn('[bridle] transcript fetch returned', res.status)
          return
        }
        type TranscriptMessage = { id: string; role: 'user' | 'assistant'; text: string; ts: number }
        type TranscriptPayload = { messages?: TranscriptMessage[] }
        type TranscriptEnvelope = { data?: TranscriptPayload }
        const body = await res.json() as TranscriptEnvelope & TranscriptPayload
        const items = body.data?.messages ?? body.messages ?? []
        this.messages = items.map((m: TranscriptMessage) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          parts: [{ type: BridlePartTypes.Text as const, text: m.text }],
          ts: m.ts,
        }))
      } catch (err) {
        console.warn('[bridle] failed to load transcript', err)
      }
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
