<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, type HTMLAttributes } from 'vue'
import { storeToRefs } from 'pinia'
import { useBridleStore } from '../../stores/bridle'
import Message from './Message.vue'
import Input from './Input.vue'
import DebugPanel from './DebugPanel.vue'
import { Card, CardContent, CardFooter, CardHeader } from '#theme/components/ui/card'
import { ScrollArea } from '#theme/components/ui/scroll-area'
import { Button } from '#theme/components/ui/button'
import { Bot, Circle, MessageSquarePlus, RotateCw } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

const props = withDefaults(defineProps<{
  apiUrl: string
  agentId: string
  token: string
  title?: string
  placeholder?: string
  class?: HTMLAttributes['class']
  showStatus?: boolean
}>(), {
  title: 'Agent Chat',
  placeholder: 'Type a message...',
  showStatus: true,
})

const store = useBridleStore()
const {
  messages,
  isConnected,
  isAgentConnected,
  isTyping,
  debugEnabled,
  markdownEnabled,
  hasMoreOlder,
  loadingOlder,
} = storeToRefs(store)

function onMarkdownChange(v: boolean | 'indeterminate') {
  store.setMarkdownEnabled(v === true)
}
const togglingDebug = ref(false)

async function onToggleDebug() {
  togglingDebug.value = true
  try {
    await store.setDebugEnabled(props.apiUrl, props.agentId, props.token, !debugEnabled.value)
  } finally {
    togglingDebug.value = false
  }
}

const inspectedMessageId = ref<string | null>(null)
const inspectedDebug = computed(() =>
  inspectedMessageId.value ? store.getDebugForMessage(inspectedMessageId.value) : null,
)
const isDebugOpen = computed({
  get: () => inspectedMessageId.value !== null,
  set: (open: boolean) => {
    if (!open) inspectedMessageId.value = null
  },
})

const connectionStatus = computed(() => {
  const chat = isConnected.value
  const agent = isAgentConnected.value
  if (chat && agent) return { label: 'Connected', color: 'text-green-500' }
  if (chat) {
    // Chat WS is up but the runtime hasn't registered with the hub. Most often
    // a transient state during agent pod restart — surface that we're waiting.
    return { label: 'Agent reconnecting…', color: 'text-orange-500' }
  }
  if (agent) {
    // Rare in practice (we lose `agent_status` events the moment our own
    // socket drops), but keep the case so a partial-network state is visible.
    return { label: 'Chat reconnecting…', color: 'text-orange-500' }
  }
  return { label: 'Disconnected', color: 'text-red-500' }
})

// Track how long the agent has been disconnected so we can offer a manual
// restart after the runtime has clearly failed to reconnect on its own.
// 30s comfortably covers normal pod-restart turnaround (~10–15s); anything
// longer almost always means the runtime is stuck and needs a kick.
const RESTART_PROMPT_AFTER_MS = 30_000
const agentDownSinceMs = ref<number | null>(null)
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => isAgentConnected.value,
  (agentUp) => {
    if (agentUp) {
      agentDownSinceMs.value = null
    } else if (agentDownSinceMs.value === null) {
      agentDownSinceMs.value = Date.now()
    }
  },
  { immediate: true },
)

const showRestartPrompt = computed(() => {
  if (isAgentConnected.value) return false
  // Only nudge a restart when the chat WS itself is up — if both are offline
  // it's likely the user's network, not the agent.
  if (!isConnected.value) return false
  const since = agentDownSinceMs.value
  if (since === null) return false
  return nowMs.value - since >= RESTART_PROMPT_AFTER_MS
})

const restarting = ref(false)
const restartError = ref<string | null>(null)

async function onRestartAgent() {
  if (restarting.value) return
  restarting.value = true
  restartError.value = null
  try {
    const url = `${props.apiUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(props.agentId)}/restart`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${props.token}` },
    })
    if (!res.ok) {
      restartError.value = `Restart failed (${res.status})`
      return
    }
    // Reset the down-since timer so we don't immediately re-prompt while the
    // new pod is coming up. agent_status will flip to true on register.
    agentDownSinceMs.value = Date.now()
  } catch (err) {
    restartError.value = (err as Error).message ?? 'Restart failed'
  } finally {
    restarting.value = false
  }
}

const scrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)

function getViewport(): HTMLElement | null {
  const root = scrollRef.value?.$el as HTMLElement | undefined
  return (root?.querySelector(
    '[data-slot="scroll-area-viewport"]',
  ) ?? null) as HTMLElement | null
}

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const viewport = getViewport()
  if (!viewport) return
  requestAnimationFrame(() => {
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
  })
}

/**
 * Pixels from the top below which we trigger an older-page load. Anything
 * smaller and a single wheel tick can blow past the threshold before the
 * fetch returns; anything larger triggers too eagerly with no visible cue.
 */
const SCROLL_LOAD_THRESHOLD_PX = 80

async function onScroll() {
  if (!hasMoreOlder.value || loadingOlder.value) return
  const viewport = getViewport()
  if (!viewport || viewport.scrollTop > SCROLL_LOAD_THRESHOLD_PX) return

  const prevScrollHeight = viewport.scrollHeight
  const prevScrollTop = viewport.scrollTop
  const added = await store.loadOlderTranscript(
    props.apiUrl,
    props.agentId,
    props.token,
  )
  if (added <= 0) return

  // Preserve the visual position of whatever the user was looking at by
  // offsetting the scroll by the height delta of the newly-prepended rows.
  await nextTick()
  const newScrollHeight = viewport.scrollHeight
  viewport.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)
}

watch(
  () => [messages.value.length, isTyping.value],
  async () => {
    await nextTick()
    scrollToBottom()
  },
)

// Cleanup handle for the viewport scroll listener attached in onMounted.
// Stored as a let so onUnmounted can detach the exact same callback.
let detachScrollListener: (() => void) | null = null

onMounted(async () => {
  // Replay persisted history first so the chat isn't blank between
  // page refreshes / agent switches; then connect the WS for live updates.
  // Clear before load so the previous agent's messages don't briefly leak
  // through (the store is a shared singleton across providers).
  store.clearMessages()
  await Promise.all([
    store.loadTranscript(props.apiUrl, props.agentId, props.token),
    store.loadAgentMeta(props.apiUrl, props.agentId, props.token),
  ])
  // Re-attach debug snapshots saved in localStorage from previous sessions —
  // makes the inspect icon survive a page refresh.
  store.loadPersistedDebug(props.agentId)
  store.connect(props.apiUrl, props.agentId, props.token)
  // 1s tick is fine — we only need it to re-evaluate `showRestartPrompt`
  // around the 30s threshold. Cheaper than a per-frame raf loop.
  nowTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  await nextTick()
  scrollToBottom('auto')

  // Scroll listener must be attached to the inner viewport — the ScrollArea
  // root is overflow:hidden and never emits `scroll`. Attaching here (after
  // first render) ensures the viewport node exists.
  const viewport = getViewport()
  if (viewport) {
    viewport.addEventListener('scroll', onScroll, { passive: true })
    detachScrollListener = () => viewport.removeEventListener('scroll', onScroll)
  }
})

onUnmounted(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
  if (detachScrollListener) {
    detachScrollListener()
    detachScrollListener = null
  }
  store.disconnect()
})

const handleSend = (text: string) => {
  store.sendMessage(text)
}

const confirmResetOpen = ref(false)
const resetting = ref(false)

async function onConfirmReset() {
  resetting.value = true
  try {
    store.disconnect()
    await store.resetTranscript(props.apiUrl, props.agentId, props.token)
    store.connect(props.apiUrl, props.agentId, props.token)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Card :class="cn('flex flex-col h-[600px] w-full max-w-2xl', props.class)">
    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-3 border-b">
      <div class="flex items-center gap-2">
        <Bot class="h-5 w-5" />
        <h3 class="font-semibold text-sm">{{ title }}</h3>
      </div>
      <div class="flex items-center gap-3">
        <Button
          v-if="showRestartPrompt"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="restarting"
          :title="restartError ?? 'Agent has not reconnected — kick the pod'"
          @click="onRestartAgent"
        >
          <RotateCw :class="cn('h-3.5 w-3.5', restarting && 'animate-spin')" />
          {{ restarting ? 'Restarting…' : 'Restart agent' }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="resetting || messages.length === 0"
          :title="messages.length === 0 ? 'Already empty' : 'Start a new chat'"
          @click="confirmResetOpen = true"
        >
          <MessageSquarePlus class="h-3.5 w-3.5" />
          New chat
        </Button>
        <div v-if="showStatus" class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle :class="cn('h-2 w-2 fill-current', connectionStatus.color)" />
          {{ connectionStatus.label }}
        </div>
      </div>
    </CardHeader>

    <ConfirmDialog
      v-model:open="confirmResetOpen"
      title="Start new chat"
      description="Delete the saved transcript for this agent and start fresh? Past messages will be removed from storage. The agent's in-memory context may persist until its next restart."
      confirm-label="Start new chat"
      @confirm="onConfirmReset"
    />

    <CardContent class="flex-1 overflow-hidden p-0">
      <ScrollArea ref="scrollRef" class="h-full">
        <div class="flex flex-col gap-4 p-4">
          <div
            v-if="loadingOlder"
            class="flex items-center justify-center py-2 text-xs text-muted-foreground"
          >
            Loading older messages…
          </div>
          <div
            v-else-if="hasMoreOlder"
            class="flex items-center justify-center py-1 text-[10px] uppercase tracking-wide text-muted-foreground/60"
          >
            Scroll up to load older messages
          </div>

          <div
            v-if="messages.length === 0 && !loadingOlder"
            class="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12"
          >
            Start a conversation with the agent
          </div>

          <Message
            v-for="msg in messages"
            :key="msg.id"
            :message="msg"
            :has-debug="msg.role === 'assistant' && !!store.getDebugForMessage(msg.id)"
            :markdown-enabled="markdownEnabled"
            @inspect="inspectedMessageId = $event"
          />

          <div v-if="isTyping" class="flex gap-3 mr-auto">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot class="h-4 w-4" />
            </div>
            <div class="rounded-lg px-3 py-2 bg-muted">
              <div class="flex gap-1">
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </CardContent>

    <CardFooter class="flex flex-col items-stretch gap-2 border-t">
      <Input
        :placeholder="placeholder"
        :disabled="!isConnected"
        @send="handleSend"
      />
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          :disabled="togglingDebug"
          :title="debugEnabled
            ? 'Prompt debug: ON — runtime is emitting debug snapshots. Click to disable.'
            : 'Prompt debug: OFF — click to enable. Pushed live to the agent without restart.'"
          class="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70 disabled:cursor-wait disabled:opacity-50"
          :class="debugEnabled
            ? 'border border-foreground/30 text-foreground'
            : 'border border-transparent'"
          @click="onToggleDebug"
        >
          Debug
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70"
          :class="markdownEnabled
            ? 'border border-foreground/30 text-foreground'
            : 'border border-transparent'"
          @click="onMarkdownChange(!markdownEnabled)"
        >
          Markdown
        </button>
      </div>
    </CardFooter>

    <DebugPanel v-model:open="isDebugOpen" :debug="inspectedDebug" />
  </Card>
</template>

<style>
/* Markdown content rendered inside an agent bubble. Global (un-scoped) so
   v-html children pick up these rules. */
.chat-md > *:first-child { margin-top: 0; }
.chat-md > *:last-child { margin-bottom: 0; }

.chat-md p { margin: 0.4em 0; }
.chat-md p:empty { display: none; }

.chat-md strong { font-weight: 600; }
.chat-md em { font-style: italic; }

.chat-md a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-md a:hover { opacity: 0.85; }

.chat-md ul,
.chat-md ol {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.chat-md ul { list-style: disc; }
.chat-md ol { list-style: decimal; }
.chat-md li { margin: 0.2em 0; }
.chat-md li > p { margin: 0; }
.chat-md li::marker { color: var(--color-muted-foreground); }

.chat-md h1,
.chat-md h2,
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 0.8em 0 0.3em;
}
.chat-md h1 { font-size: 1.15em; }
.chat-md h2 { font-size: 1.05em; }
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 { font-size: 1em; }

.chat-md code {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.9em;
}

.chat-md pre {
  background-color: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 0.5rem;
  padding: 0.75em 0.9em;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.85em;
  line-height: 1.5;
}
.chat-md pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

.chat-md .code-block {
  position: relative;
}
.chat-md .code-copy {
  position: absolute;
  top: 0.85em;
  right: 0.5em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  padding: 0;
  border-radius: 0.3rem;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-muted-foreground);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, background-color 0.15s, color 0.15s, border-color 0.15s;
}
.chat-md .code-block:hover .code-copy,
.chat-md .code-copy:focus-visible,
.chat-md .code-copy.copied {
  opacity: 1;
  pointer-events: auto;
}
.chat-md .code-copy:hover {
  background-color: var(--color-accent);
  color: var(--color-accent-foreground);
}
.chat-md .code-copy.copied {
  color: var(--color-foreground);
  border-color: color-mix(in srgb, currentColor 30%, transparent);
}
.chat-md .code-copy svg {
  display: block;
}
.chat-md .code-copy .icon-check {
  display: none;
}
.chat-md .code-copy.copied .icon-copy {
  display: none;
}
.chat-md .code-copy.copied .icon-check {
  display: block;
}

.chat-md blockquote {
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  padding-left: 0.9em;
  margin: 0.5em 0;
  color: var(--color-muted-foreground);
  font-style: italic;
}

.chat-md hr {
  border: 0;
  border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  margin: 0.8em 0;
}

.chat-md table {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.9em;
  width: 100%;
}
.chat-md th,
.chat-md td {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  padding: 0.35em 0.6em;
  text-align: left;
}
.chat-md th {
  font-weight: 600;
  background-color: color-mix(in srgb, currentColor 6%, transparent);
}
</style>
