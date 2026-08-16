<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, type HTMLAttributes } from 'vue'
import { storeToRefs } from 'pinia'
import { useBridleStore, type IBridleMessageData, type IBridleThinkingStep, type IThinkingBlock } from '../../stores/bridle'
import Message from './Message.vue'
import Input from './Input.vue'
import DebugPanel from './DebugPanel.vue'
import { Card, CardContent, CardFooter, CardHeader } from '#theme/components/ui/card'
import { ScrollArea } from '#theme/components/ui/scroll-area'
import { Button } from '#theme/components/ui/button'
import { Bot, ChevronDown, Circle, MessageSquarePlus, RotateCw } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'
import { renderMarkdown } from '../../utils/markdown'

const props = withDefaults(defineProps<{
  apiUrl: string
  agentId: string
  token: string
  title?: string
  placeholder?: string
  class?: HTMLAttributes['class']
  showStatus?: boolean
  // Hosts with their own restart controls (the admin agent page) turn the
  // header's built-in restart prompt off to keep the header uncluttered.
  restartPrompt?: boolean
  // Host-supplied reconciled agent state. The WS alone can't tell the truth
  // fast enough: after a restart the OLD pod keeps its socket alive for a few
  // seconds ("Connected" while the pod is dying), and on a freshly opened
  // page a failed agent reads as "reconnecting" for 30s. Hosts that know the
  // real state (the admin agent page) pass it here; null = derive from WS.
  agentState?: 'restarting' | 'failed' | 'stopped' | null
  // Host-supplied debugEnabled from an agent record the host already fetched.
  // When set (non-null), the widget skips its own GET /agents/:id — the admin
  // agent page otherwise loads the same agent twice on every open.
  initialDebugEnabled?: boolean | null
}>(), {
  title: 'Agent Chat',
  placeholder: 'Type a message...',
  showStatus: true,
  restartPrompt: true,
  agentState: null,
  initialDebugEnabled: null,
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
  thinkingBlocks,
} = storeToRefs(store)

// ── Thinking timeline (CLEAN-10) ─────────────────────────────────────
// Messages and thinking blocks interleaved by timestamp — a frozen block
// stays anchored above the answer it produced, Rovo-style.
const thinkingLabel = computed(() => `${props.title} is thinking…`)
const hasOpenThinking = computed(() => thinkingBlocks.value.some(b => b.status === 'thinking'))

interface IChatFlowItem {
  message?: IBridleMessageData
  block?: IThinkingBlock
  ts: number
}
const chatFlow = computed<IChatFlowItem[]>(() => {
  const items: IChatFlowItem[] = messages.value.map(m => ({ message: m, ts: m.ts }))
  for (const b of thinkingBlocks.value) items.push({ block: b, ts: b.ts })
  return items.sort((a, b) => a.ts - b.ts)
})

// A turn may span several segments (blocks) — turnId + seg identifies one.
function blockKey(b: IThinkingBlock): string {
  return `${b.turnId}#${b.seg}`
}

// segment key → collapsed override; unset = open while thinking, collapsed when done.
const collapsedBlocks = ref<Record<string, boolean>>({})
// stepId → detail expanded; steps arrive collapsed.
const expandedSteps = ref<Record<string, boolean>>({})

function isBlockCollapsed(b: IThinkingBlock): boolean {
  return collapsedBlocks.value[blockKey(b)] ?? b.status === 'done'
}
function toggleBlock(b: IThinkingBlock): void {
  collapsedBlocks.value[blockKey(b)] = !isBlockCollapsed(b)
}
function toggleStep(s: IBridleThinkingStep): void {
  expandedSteps.value[s.id] = !expandedSteps.value[s.id]
}

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
  if (props.agentState === 'restarting') {
    return { label: 'Agent restarting…', color: 'text-orange-500' }
  }
  if (props.agentState === 'failed') {
    return { label: 'Agent offline', color: 'text-red-500' }
  }
  if (props.agentState === 'stopped') {
    return { label: 'Agent stopped', color: 'text-muted-foreground' }
  }
  const chat = isConnected.value
  const agent = isAgentConnected.value
  if (chat && agent) return { label: 'Connected', color: 'text-green-500' }
  if (chat) {
    // Chat WS is up but the runtime hasn't registered with the hub. During a
    // normal pod restart that's transient — but once the agent has been gone
    // past the restart-prompt window it's not "reconnecting" anymore, it's
    // down; stop implying progress that isn't happening.
    if (agentDownTooLong.value) {
      return { label: 'Agent offline', color: 'text-red-500' }
    }
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

const agentDownTooLong = computed(() => {
  const since = agentDownSinceMs.value
  return since !== null && nowMs.value - since >= RESTART_PROMPT_AFTER_MS
})

const showRestartPrompt = computed(() => {
  if (!props.restartPrompt) return false
  if (isAgentConnected.value) return false
  // Only nudge a restart when the chat WS itself is up — if both are offline
  // it's likely the user's network, not the agent.
  if (!isConnected.value) return false
  return agentDownTooLong.value
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
  () => [messages.value.length, isTyping.value, thinkingBlocks.value.reduce((n, b) => n + b.steps.length, 0)],
  async () => {
    // Capture BEFORE the DOM grows: follow only a reader who was already at
    // the bottom — never yank back someone who scrolled up to re-read.
    const viewport = getViewport()
    const nearBottom =
      !viewport ||
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
    await nextTick()
    if (nearBottom) scrollToBottom()
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
  // The host may already hold the agent record (admin page useAsyncData) —
  // seeding from the prop avoids a duplicate GET /agents/:id on every open.
  if (props.initialDebugEnabled !== null) {
    store.debugEnabled = props.initialDebugEnabled
    await store.loadTranscript(props.apiUrl, props.agentId, props.token)
  } else {
    await Promise.all([
      store.loadTranscript(props.apiUrl, props.agentId, props.token),
      store.loadAgentMeta(props.apiUrl, props.agentId, props.token),
    ])
  }
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
        <!-- Starting a new chat needs a live agent — while it's down the
             button is noise next to the status, so hide it entirely. -->
        <Button
          v-if="isConnected && isAgentConnected && !agentState"
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

          <template
            v-for="item in chatFlow"
            :key="item.message ? item.message.id : (item.block ? blockKey(item.block) : '')"
          >
            <Message
              v-if="item.message"
              :message="item.message"
              :has-debug="item.message.role === 'assistant' && !!store.getDebugForMessage(item.message.id)"
              :markdown-enabled="markdownEnabled"
              @inspect="inspectedMessageId = $event"
            />
            <div
              v-else-if="item.block"
              class="mr-auto flex max-w-full flex-col gap-1.5 px-1"
              :role="item.block.status === 'thinking' ? 'status' : undefined"
              :aria-label="item.block.status === 'thinking' ? thinkingLabel : undefined"
            >
              <div class="flex items-center gap-1.5">
                <span
                  :class="['text-sm font-medium text-muted-foreground', item.block.status === 'thinking' && 'shimmer shimmer-duration-1600']"
                >{{ item.block.status === 'thinking' ? thinkingLabel : 'Thought for a moment' }}</span>
                <button
                  v-if="item.block.steps.length"
                  type="button"
                  class="p-0.5 text-muted-foreground"
                  :aria-expanded="!isBlockCollapsed(item.block)"
                  aria-label="Toggle thinking details"
                  @click="toggleBlock(item.block)"
                >
                  <ChevronDown :class="cn('h-3.5 w-3.5 transition-transform', isBlockCollapsed(item.block) && '-rotate-90')" />
                </button>
              </div>
              <div
                v-if="item.block.steps.length && !isBlockCollapsed(item.block)"
                class="ml-1 flex flex-col gap-0.5 border-l border-border pl-3"
              >
                <div
                  v-for="s in item.block.steps"
                  :key="s.id"
                  class="flex flex-col items-start"
                >
                  <button
                    v-if="s.detail"
                    type="button"
                    class="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground"
                    :aria-expanded="!!expandedSteps[s.id]"
                    :aria-controls="`bridle-admin-step-${s.id}`"
                    @click="toggleStep(s)"
                  >
                    <span :class="s.state === 'active' ? 'shimmer shimmer-duration-1600 text-foreground' : ''">{{ s.label }}</span>
                    <ChevronDown :class="cn('h-3 w-3 shrink-0 transition-transform', !expandedSteps[s.id] && '-rotate-90')" />
                  </button>
                  <div v-else class="py-0.5 text-[13px] text-muted-foreground">
                    <span :class="s.state === 'active' ? 'shimmer shimmer-duration-1600 text-foreground' : ''">{{ s.label }}</span>
                  </div>
                  <div
                    v-if="s.detail && expandedSteps[s.id]"
                    :id="`bridle-admin-step-${s.id}`"
                    class="mb-1.5 max-w-full border-l-2 border-border pl-2 text-[13px] leading-relaxed text-muted-foreground wrap-anywhere"
                    v-html="renderMarkdown(s.detail)"
                  />
                </div>
              </div>
            </div>
          </template>

          <div
            v-if="isTyping && !hasOpenThinking"
            class="mr-auto flex items-center gap-3"
            role="status"
            :aria-label="thinkingLabel"
          >
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot class="h-4 w-4" />
            </div>
            <span class="shimmer shimmer-duration-1600 text-sm font-medium text-muted-foreground">{{ thinkingLabel }}</span>
          </div>
        </div>
      </ScrollArea>
    </CardContent>

    <CardFooter class="flex flex-col items-stretch gap-2 border-t">
      <!-- Stays visible when the agent is down — a hidden input reads as a
           broken layout; disabled communicates "chat exists, agent doesn't". -->
      <Input
        :placeholder="placeholder"
        :disabled="!isConnected || !isAgentConnected || agentState !== null"
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
