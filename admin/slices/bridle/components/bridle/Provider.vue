<script setup lang="ts">
import { ref, computed, nextTick, toRefs, watch, onMounted, onUnmounted, type HTMLAttributes } from 'vue'
import { storeToRefs } from 'pinia'
import { queueStateOf, useBridleStore } from '../../stores/bridle'
import { canTake, held } from '../../utils/queue'
import { buildChatFlow, type IChatFlowDayItem } from '../../utils/chatFlow'
import Message from './Message.vue'
import Thinking from './Thinking.vue'
import Input from './Input.vue'
import DropZone from './DropZone.vue'
import Queue from './queue/Provider.vue'
import Toggles from './Toggles.vue'
import ToolCatalogButton from '#toolCatalog/components/toolCatalog/Button.vue'
import DebugPanel from './DebugPanel.vue'
import { Card, CardContent, CardFooter, CardHeader } from '#theme/components/ui/card'
import { ScrollArea } from '#theme/components/ui/scroll-area'
import { Button } from '#theme/components/ui/button'
import { Skeleton } from '#theme/components/ui/skeleton'
import { Bot, Circle, MessageSquarePlus, RotateCw } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'
import { authedFetch } from '#auth/utils/authedFetch'
import { useAuthStore } from '#auth/stores/auth'
import { ownChannel } from '../../utils/ownChannel'
import { shouldShowOfflineHint } from '../../utils/offlineHint'

// No `token` prop: every request and the socket read the current bearer from
// the auth store, so a renewal mid-session never leaves this widget behind.
const props = withDefaults(defineProps<{
  apiUrl: string
  agentId: string
  // Which of the agent's conversations this is. The admin panel has one —
  // the viewer's own conversation with the agent.
  channel?: string
  title?: string
  placeholder?: string
  class?: HTMLAttributes['class']
  showStatus?: boolean
  // Hosts with their own restart controls (the admin agent page) turn the
  // header's built-in restart prompt off to keep the header uncluttered.
  restartPrompt?: boolean
  // The Tools button (CLEAN-109). Hosts with their own header actions (the
  // admin agent page puts it beside Share and Edit) turn this one off.
  toolsButton?: boolean
  // No card chrome and no header (specs/017): the admin agent workspace
  // gives the conversation the whole column, so the border, the title row and
  // its buttons go. What the header held that still matters — New chat and
  // the connection status — moves into the composer's toggle row, and the
  // transcript is capped at a readable measure instead of the card's width.
  frameless?: boolean
  // Host-supplied reconciled agent state. The WS alone can't tell the truth
  // fast enough: after a restart the OLD pod keeps its socket alive for a few
  // seconds ("Connected" while the pod is dying), and on a freshly opened
  // page a failed agent reads as "reconnecting" for 30s. Hosts that know the
  // real state (the admin agent page) pass it here; null = derive from WS.
  agentState?: 'restarting' | 'failed' | 'stopped' | 'unreachable' | 'connecting' | null
  // Troubleshooting links for the "pod is up but the runtime never reached
  // the bridle hub" state. Only rendered once `agentState` is 'unreachable' —
  // the server's own verdict after watching a Running+Ready pod stay off the
  // hub — so it never speaks over a plain reconnect. It then replaces the bare
  // offline line with the status reason, the pod env preview (missing BRIDLE_*
  // vars are visible there), the bridle settings page, and the restart note.
  offlineHint?: { reason: string | null; envHref: string; settingsHref: string } | null
  // The agent runs without some of its tool servers (CLEAN-245). The host
  // words it (it knows who may be told a server's name); this widget only
  // shows the line above the composer. Nothing is blocked by it.
  toolNotice?: { label: string; detail: string } | null
  // Host-supplied debugEnabled from an agent record the host already fetched.
  // When set (non-null), the widget skips its own GET /agents/:id — the admin
  // agent page otherwise loads the same agent twice on every open.
  initialDebugEnabled?: boolean | null
  // False when the viewer may not manage this agent (CLEAN-232: the Ranch
  // admin agent for anybody but the Owner). The conversation works as ever;
  // what manages the agent from inside it is not offered — the restart
  // prompt, the Debug toggle, the link to its limits and the Tools panel's
  // "Restart now" — because the API answers each with "Agent not found".
  manageable?: boolean
}>(), {
  // The viewer's own conversation: `admin` for the Owner, their user id for
  // an Admin (CLEAN-236).
  channel: () => ownChannel(useAuthStore().user),
  title: 'Agent Chat',
  placeholder: 'Type a message...',
  showStatus: true,
  restartPrompt: true,
  toolsButton: true,
  frameless: false,
  agentState: null,
  offlineHint: null,
  toolNotice: null,
  initialDebugEnabled: null,
  manageable: true,
})

const store = useBridleStore()
const authStore = useAuthStore()
const { markdownEnabled } = storeToRefs(store)

// This chat's own record in the store — messages, flags, socket, staged files.
// Every mounted chat used to share one; the Rancher panel and an agent's Chat
// tab then wrote into each other's conversation (CLEAN-102). Taken once, in
// setup: hosts remount this widget per agent rather than swapping `agentId`.
const conversation = store.acquire(props.agentId, props.channel)
const conversationKey = conversation.key
const {
  messages,
  isConnected,
  isAgentConnected,
  isTyping,
  debugEnabled,
  hasMoreOlder,
  loadingOlder,
  thinkingBlocks,
  notice,
  transcriptLoads,
} = toRefs(conversation)

// ── Opening (CLEAN-260) ──────────────────────────────────────────────
// What the feed says while it has no message to show: placeholders until the
// newest transcript page has answered, and only then the invitation. Twin of
// `feedState` in the app console's chat. The composer is there throughout.
const feedState = computed<'messages' | 'loading' | 'empty'>(() => {
  if (messages.value.length) return 'messages'
  return transcriptLoads.value > 0 ? 'loading' : 'empty'
})
// Widths of the placeholder bubbles; even ones are the operator's, on the right.
const PLACEHOLDER_BUBBLES = ['w-2/5', 'w-3/5', 'w-1/3', 'w-1/2', 'w-2/5']

// ── Thinking timeline (CLEAN-10) ─────────────────────────────────────
// Messages and thinking blocks interleaved by arrival order (`seq`) — a frozen
// block stays anchored above the answer it produced, Rovo-style. Never by
// `ts`: the operator's message carries the browser's clock and the reply the
// agent's, and a skew between them put answers above their questions.
const thinkingLabel = computed(() => `${props.title} is thinking…`)
const hasOpenThinking = computed(() => thinkingBlocks.value.some(b => b.status === 'thinking'))

// Start of the local day — all "Today" / "Yesterday" needs. Derived from the
// 1s clock below but only changes at midnight, so the flow is not rebuilt
// every second.
const dayStartMs = computed(() => new Date(nowMs.value).setHours(0, 0, 0, 0))

const chatFlow = computed(() =>
  buildChatFlow(messages.value, thinkingBlocks.value, { locale: 'en', now: dayStartMs.value }),
)

function dayLabel(item: IChatFlowDayItem): string {
  if (item.relative === 'today') return 'Today'
  if (item.relative === 'yesterday') return 'Yesterday'
  return item.label
}

function onMarkdownChange(v: boolean | 'indeterminate') {
  store.setMarkdownEnabled(v === true)
}
const togglingDebug = ref(false)

async function onToggleDebug() {
  togglingDebug.value = true
  try {
    await store.setDebugEnabled(props.apiUrl, props.agentId, !debugEnabled.value, props.channel)
  } finally {
    togglingDebug.value = false
  }
}

// ── Visitors are being asked to wait (CLEAN-224) ─────────────────────
// Operators are not limited, so this chat keeps working when the agent is at
// its message limit — which is exactly when an operator testing it would
// conclude that it is fine for everybody. One quiet line says otherwise. The
// entry is the store's, set by the hub's `agent_limit` event and removed when
// room is made or the wait passes; it changes nothing about sending.
const visitorLimit = computed(() => store.visitorLimits[props.agentId] ?? null)
// The Request limit block of the agent's Overview, where its limits are set
// (it keeps the anchor of the card it replaced).
const limitsHref = computed(
  () => `/agents/${encodeURIComponent(props.agentId)}?tab=overview#visibility-embed`,
)

const inspectedMessageId = ref<string | null>(null)
const inspectedDebug = computed(() =>
  inspectedMessageId.value ? store.getDebugForMessage(conversationKey, inspectedMessageId.value) : null,
)
const isDebugOpen = computed({
  get: () => inspectedMessageId.value !== null,
  set: (open: boolean) => {
    if (!open) inspectedMessageId.value = null
  },
})

const connectionStatus = computed<{ label: string; color: string } | null>(() => {
  // The session-ended dialog owns the screen: a "Disconnected" or
  // "Chat reconnecting…" line under it would be noise about the wrong thing.
  if (authStore.sessionEnded) return null
  if (props.agentState === 'restarting') {
    return { label: 'Agent restarting…', color: 'text-orange-500' }
  }
  if (props.agentState === 'failed') {
    return { label: 'Agent offline', color: 'text-red-500' }
  }
  if (props.agentState === 'stopped') {
    return { label: 'Agent stopped', color: 'text-muted-foreground' }
  }
  if (props.agentState === 'unreachable') {
    return { label: 'Agent unreachable', color: 'text-orange-500' }
  }
  if (props.agentState === 'connecting') {
    return { label: 'Connecting tools…', color: 'text-orange-500' }
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

// Track how long the agent has been continuously absent. Two surfaces read
// this clock: the manual restart nudge below, and the offline hint's settle
// window. It measures the agent, not our socket — a chat WS drop leaves
// `isAgentConnected` already false, so the watch doesn't refire and the window
// survives our own reconnect.
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

// Actionable variant of "Agent is not connected" — the rule itself lives in
// `utils/offlineHint`, where it is documented and can be exercised on its own.
const showOfflineHint = computed(() =>
  shouldShowOfflineHint({
    hasHint: props.offlineHint !== null,
    chatConnected: isConnected.value,
    agentConnected: isAgentConnected.value,
    agentState: props.agentState,
    agentDownForMs:
      agentDownSinceMs.value === null ? null : nowMs.value - agentDownSinceMs.value,
  }),
)

const showRestartPrompt = computed(() => {
  if (!props.restartPrompt || !props.manageable) return false
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
    const res = await authedFetch(url, { method: 'POST' })
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
  const added = await store.loadOlderTranscript(props.apiUrl, props.agentId, props.channel)
  if (added <= 0) return

  // Preserve the visual position of whatever the user was looking at by
  // offsetting the scroll by the height delta of the newly-prepended rows.
  await nextTick()
  const newScrollHeight = viewport.scrollHeight
  viewport.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)
}

watch(
  () => [messages.value.length, isTyping.value, thinkingBlocks.value.reduce((n, b) => n + b.steps.length, 0), notice.value],
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
let unmounted = false

onMounted(async () => {
  // Start the clock before anything that awaits: both time-gated surfaces (the
  // restart prompt and the offline hint) read `nowMs`, and a slow transcript
  // load or token refresh must not freeze it. A 1s tick is enough resolution
  // for 5s/30s thresholds and cheaper than a per-frame raf loop.
  nowTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  // Replay persisted history first so the chat isn't blank between
  // page refreshes / agent switches; then connect the WS for live updates.
  // No clearing first: the record is this conversation's alone, and the load
  // MERGES — not-delivered messages and a turn still in flight stay put.
  // The host may already hold the agent record (admin page useAsyncData) —
  // seeding from the prop avoids a duplicate GET /agents/:id on every open.
  if (props.initialDebugEnabled !== null) {
    conversation.debugEnabled = props.initialDebugEnabled
    await store.loadTranscript(props.apiUrl, props.agentId, props.channel)
  } else {
    await Promise.all([
      store.loadTranscript(props.apiUrl, props.agentId, props.channel),
      store.loadAgentMeta(props.apiUrl, props.agentId, props.channel),
    ])
  }
  // Left while the transcript was loading — connecting now would open a
  // socket nobody is around to close.
  if (unmounted) return
  // Re-attach debug snapshots saved in localStorage from previous sessions —
  // makes the inspect icon survive a page refresh.
  store.loadPersistedDebug(props.agentId, props.channel)
  await store.connect(props.apiUrl, props.agentId, props.channel)
  if (unmounted) {
    // Same race, one await later: hang up unless another chat holds the key.
    if (conversation.holders === 0) store.disconnect(conversationKey)
    return
  }
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
  unmounted = true
  // The last chat showing this conversation closes its socket and drops the
  // staged files (their object URLs would otherwise leak).
  store.release(conversationKey)
})

// ── Queue (CLEAN-245) ────────────────────────────────────────
// The composer is never closed for what the agent is doing: starting,
// answering, connecting its tools. What is written meanwhile waits in the
// queue (at most three) and goes out by itself, one per turn. Nothing in the
// admin console takes the right to write away, so nothing disables it here.

const queue = computed(() => store.getQueue(conversationKey))
const queueState = computed(() => queueStateOf(conversation, props.agentState))
/** The agent can take a message now. */
const takes = computed(() => canTake(queueState.value))
/** Why the queue waits for the person rather than the agent, if it does. */
const heldReason = computed(() => held(queue.value, queueState.value, nowMs.value))

// The one place that sends from the queue: whenever the agent becomes free
// (it came up, a turn closed), the hold is lifted, or the list changes.
watch(
  [takes, heldReason, () => queue.value.length],
  ([free, reason, waiting]) => {
    if (free && !reason && waiting > 0) void store.drain(conversationKey, props.agentState)
  },
  { immediate: true },
)

// The panel sits between the transcript and the composer: a row more takes
// its height from the transcript. A reader at the bottom stays there.
watch([() => queue.value.length, heldReason], async () => {
  const viewport = getViewport()
  const nearBottom =
    !viewport ||
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
  await nextTick()
  if (nearBottom) scrollToBottom()
})

const inputRef = ref<InstanceType<typeof Input> | null>(null)

const handleSend = async (text: string) => {
  const result = await store.submit(conversationKey, text, props.agentState)
  if (result === 'sent') {
    // Sending always lands on the new message, wherever the reader was — the
    // near-bottom rule above is for INCOMING content only.
    await nextTick()
    scrollToBottom()
  }
  return result
}

const onResend = (id: string) => {
  store.resend(conversationKey, id)
}

const onDiscard = (id: string) => {
  store.discard(conversationKey, id)
}

// ── Drag and drop ────────────────────────────
// The drop target is the whole chat card, not the composer, so the drag state
// lives here and the composer is swapped out while a file is overhead.

const isDraggingFile = ref(false)
/**
 * `dragleave` fires every time the pointer crosses into a child element, so a
 * naive boolean flickers as you move over bubbles and avatars. Counting enters
 * against leaves and treating zero as "gone" is the standard fix.
 */
const dragDepth = ref(0)

/** Only file drags matter — dragging selected text must not arm the zone. */
function dragHasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return types ? Array.from(types).includes('Files') : false
}

function onDragEnter(event: DragEvent) {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth.value++
  isDraggingFile.value = true
}

function onDragOver(event: DragEvent) {
  if (!dragHasFiles(event)) return
  // Without this the browser treats the drop as a navigation.
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function onDragLeave(event: DragEvent) {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDraggingFile.value = false
}

function onDrop(event: DragEvent) {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  // Reset unconditionally: a drop ends the drag however the counter got here.
  dragDepth.value = 0
  isDraggingFile.value = false

  const files = event.dataTransfer?.files
  if (files?.length) {
    store.stageFiles(conversationKey, props.apiUrl, files)
  }
}

// The hub drops the socket when the session dies and socket.io treats that
// server-initiated disconnect as final. Once the person signs back in through
// the session-ended dialog, bring the live chat back without a reload.
watch(
  () => authStore.isAuthenticated,
  (signedIn) => {
    if (signedIn && !isConnected.value) {
      void store.connect(props.apiUrl, props.agentId, props.channel)
    }
  },
)

/**
 * A file released anywhere else on the page would otherwise make the browser
 * navigate to it, throwing away the conversation. Swallow the default while
 * this chat is mounted.
 */
function preventWindowDrop(event: DragEvent) {
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragover', preventWindowDrop)
  window.addEventListener('drop', preventWindowDrop)
})

onUnmounted(() => {
  window.removeEventListener('dragover', preventWindowDrop)
  window.removeEventListener('drop', preventWindowDrop)
})

const confirmResetOpen = ref(false)
const resetting = ref(false)

async function onConfirmReset() {
  resetting.value = true
  try {
    store.disconnect(conversationKey)
    await store.resetTranscript(props.apiUrl, props.agentId, props.channel)
    await store.connect(props.apiUrl, props.agentId, props.channel)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Card
    :class="cn(
      'flex flex-col gap-0 h-[600px] w-full max-w-2xl',
      frameless && 'max-w-none border-0 bg-transparent py-0 shadow-none',
      props.class,
    )"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <CardHeader
      v-if="!frameless"
      class="flex flex-row items-center justify-between space-y-0 pb-3 border-b"
    >
      <div class="flex items-center gap-2">
        <Bot class="h-5 w-5" />
        <h3 class="font-semibold text-sm">{{ title }}</h3>
      </div>
      <div class="flex items-center gap-3">
        <ToolCatalogButton
          v-if="toolsButton"
          :agent-id="agentId"
          class="h-7 px-2 text-xs"
        />
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
        <div v-if="showStatus && connectionStatus" class="flex items-center gap-1.5 text-xs text-muted-foreground">
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

    <CardContent class="min-h-0 flex-1 overflow-hidden p-0">
      <ScrollArea ref="scrollRef" class="h-full">
        <div
          class="flex flex-col gap-4 p-4"
          :class="frameless && 'mx-auto w-full max-w-5xl px-0'"
        >
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

          <!-- The transcript is on its way (CLEAN-260): where its messages
               will stand, instead of an invitation that says "empty". -->
          <div
            v-if="feedState === 'loading'"
            class="flex flex-col gap-4"
            role="status"
            aria-busy="true"
            data-chat-state="loading"
          >
            <span class="sr-only">Loading the conversation…</span>
            <div
              v-for="(width, i) in PLACEHOLDER_BUBBLES"
              :key="i"
              class="flex"
              :class="i % 2 === 0 ? 'justify-end' : undefined"
              aria-hidden="true"
            >
              <Skeleton class="h-11 rounded-2xl" :class="width" />
            </div>
          </div>
          <div
            v-else-if="feedState === 'empty' && !loadingOlder"
            class="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12"
            data-chat-state="empty"
          >
            Start a conversation with the agent
          </div>

          <template
            v-for="item in chatFlow"
            :key="item.key"
          >
            <Message
              v-if="item.kind === 'message'"
              :message="item.message"
              :has-debug="item.message.role === 'assistant' && !!store.getDebugForMessage(conversationKey, item.message.id)"
              :markdown-enabled="markdownEnabled"
              :debug-enabled="debugEnabled"
              @inspect="inspectedMessageId = $event"
              @resend="onResend"
              @discard="onDiscard"
              @proposal-applied="handleSend"
              @open-source="(id: string, n: number) => store.openSource(conversationKey, id, n)"
              @rate-source="(id: string, n: number, rating: 1 | -1 | null) => store.rateSource(conversationKey, id, n, rating)"
            />
            <div
              v-else-if="item.kind === 'day'"
              class="flex items-center justify-center py-1 text-[10px] uppercase tracking-wide text-muted-foreground/60"
            >
              {{ dayLabel(item) }}
            </div>
            <Thinking
              v-else-if="item.kind === 'block'"
              :block="item.block"
              :label="thinkingLabel"
            />
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

          <!-- A turn that went silent says so, instead of the shimmer just
               disappearing as if nothing had been asked. -->
          <p
            v-if="notice"
            class="text-center text-xs text-muted-foreground"
            role="status"
          >
            {{ notice }}
          </p>
        </div>
      </ScrollArea>
    </CardContent>

    <CardFooter
      class="flex shrink-0 flex-col items-stretch gap-2 border-t pt-4"
      :class="frameless && 'mx-auto w-full max-w-5xl border-t-0 px-0 pt-3 pb-0'"
    >
      <div
        v-if="showOfflineHint"
        class="rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-700 dark:text-orange-300"
      >
        <p class="font-medium">Agent is not connected to the bridle hub.</p>
        <p v-if="offlineHint?.reason" class="mt-1">{{ offlineHint.reason }}</p>
        <p class="mt-1">
          Check the
          <NuxtLink :to="offlineHint!.envHref" class="underline hover:no-underline">
            pod environment preview
          </NuxtLink>
          (missing BRIDLE_* variables show up there) and the
          <NuxtLink :to="offlineHint!.settingsHref" class="underline hover:no-underline">
            bridle integration settings
          </NuxtLink>.
          After fixing the settings, restart the agent — a live pod does not
          pick them up.
        </p>
      </div>
      <p
        v-if="toolNotice"
        class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        role="status"
        data-tool-state="limited"
      >
        <span class="font-medium">{{ toolNotice.label }}.</span>
        {{ toolNotice.detail }}
      </p>
      <!-- Informational only: neutral, not an error, and Send is untouched. -->
      <p
        v-if="visitorLimit"
        class="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        role="status"
        data-visitor-limit-line
        :data-limit-window="visitorLimit.window"
      >
        Visitors are being asked to wait — this agent is at its message limit.
        Your messages are not limited.
        <NuxtLink
          v-if="manageable"
          :to="limitsHref"
          class="font-medium text-foreground underline hover:no-underline"
          data-visitor-limit-link
        >Limits</NuxtLink>
      </p>
      <!-- The composer is replaced, not covered: the dashed block takes its
           place while a file is overhead. The draft and staged files live in
           the component and the store, so the swap cannot lose them. -->
      <Queue
        :conversation-key="conversationKey"
        :held="heldReason"
        @edit="inputRef?.requestEdit($event)"
      />
      <DropZone v-if="isDraggingFile" />
      <!-- Open whatever the agent is doing (CLEAN-245): what cannot be sent
           yet waits in the queue above. -->
      <Input
        v-else
        ref="inputRef"
        :api-url="apiUrl"
        :agent-id="agentId"
        :channel="channel"
        :placeholder="placeholder"
        :boxed="frameless"
        :manageable="manageable"
        :submit="handleSend"
      >
        <!-- Frameless: the toggles sit inside the composer box, and the two
             things the header carried that still matter — New chat and the
             connection status — sit at its right end. -->
        <template v-if="frameless" #tools>
          <Toggles
            :debug-enabled="debugEnabled"
            :markdown-enabled="markdownEnabled"
            :toggling-debug="togglingDebug"
            :can-debug="manageable"
            @toggle-debug="onToggleDebug"
            @toggle-markdown="onMarkdownChange(!markdownEnabled)"
          />
        </template>
        <template v-if="frameless" #status>
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
          <div
            v-if="showStatus && connectionStatus"
            class="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Circle :class="cn('h-2 w-2 fill-current', connectionStatus.color)" />
            {{ connectionStatus.label }}
          </div>
        </template>
      </Input>
      <div v-if="!frameless" class="flex items-center justify-end gap-2">
        <Toggles
          :debug-enabled="debugEnabled"
          :markdown-enabled="markdownEnabled"
          :toggling-debug="togglingDebug"
          :can-debug="manageable"
          @toggle-debug="onToggleDebug"
          @toggle-markdown="onMarkdownChange(!markdownEnabled)"
        />
      </div>
    </CardFooter>

    <DebugPanel v-model:open="isDebugOpen" :debug="inspectedDebug" />
  </Card>
</template>
