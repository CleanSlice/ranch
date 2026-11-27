<script setup lang="ts">
import type { IBridleConversation } from '#bridle/domain';
import { canManageAgent, canShareAgent } from '#agent/utils/agentAccess';
import { useAgentToolState } from '#agent/composables/useAgentToolState';

const props = defineProps<{
  id: string;
  /**
   * Inside the workspace the sheet above carries identity and actions, so
   * the header strip and the restart banner stay out; the restart overlay
   * still reacts to the store's status, whichever surface flipped it.
   */
  compact?: boolean;
}>();

const agentStore = useAgentStore();
const authStore = useAuthStore();

// The request is for `refresh` and for knowing when it has answered; what
// renders is the store's record (docs/state.md) — the same object the rail
// row shows, so the header pill and the row cannot disagree. `fetchById`
// upserts into it.
//
// Not awaited (CLEAN-260). This component is remounted for every agent, and
// an awaited request at the top of its setup left the pane under the sheet
// empty (no feed, no composer, no loader) for as long as the request took,
// on every switch. The record is in the store already (the list brought it)
// and the conversation is kept in the browser, so the chat is drawn at once
// and the request refreshes the record behind it. A request that fails
// leaves the record alone and is told by the sheet (`refreshFailedFor`).
const { refresh, status } = useAsyncData(
  `agent-${props.id}`,
  () => agentStore.fetchById(props.id),
  { lazy: true },
);
// Latched on the first answer: the 3 s status poll below asks again and
// again, and "pending" then is not "nothing is known yet". Read off the
// request's own status, which every holder of this key shares, so a second
// mount while the first one's request is still open hears the same answer.
const settled = ref(false);
watch(
  status,
  (now) => {
    if (now === 'success' || now === 'error') settled.value = true;
  },
  { immediate: true },
);
const agent = computed(() => agentStore.byId(props.id));
// Nothing is known of this agent yet and the answer is still on its way: a
// cold load by address. The chat is there all the same (the conversation the
// browser keeps, or placeholders, and the composer); "unavailable" is said
// only once the request has answered without a record.
const waiting = computed(() => !agent.value && !settled.value);

/**
 * The conversation this page shows — the same `{ key: agentId, agentId }` the
 * chat below falls back to — for the header's "New chat". A plain object per
 * agent, so the button is not handed a new descriptor on every render.
 */
const conversation = computed<IBridleConversation | null>(() =>
  agent.value ? { key: agent.value.id, agentId: agent.value.id } : null,
);

// Per agent, not per role: the Ranch admin agent is the Owner's alone
// (CLEAN-232).
const canManage = computed(() =>
  agent.value ? canManageAgent(authStore.role, agent.value) : false,
);
// Share is for whoever opens the agent, the Ranch assistant apart: its link
// is the Owner's (CLEAN-269).
const canShare = computed(() =>
  agent.value ? canShareAgent(authStore.role, agent.value) : false,
);

// ── Tool servers (CLEAN-245) ──────────────────────────────────
// The list poll writes `toolState` onto the record; an open chat hears the
// hub first, so its word is patched in — the rail row, the sheet and this
// chat then read one fact (docs/state.md). Until the hub has spoken for this
// conversation the record keeps what the poll said.
const bridleStore = useBridleStore();
watch(
  () =>
    [
      bridleStore.agentOnlineFor(props.id),
      bridleStore.toolsFor(props.id),
    ] as const,
  ([online, tools]) => {
    const current = agent.value;
    if (!current || online !== true) return;
    if (current.toolState !== tools) agentStore.patch(current.id, { toolState: tools });
  },
);
// Named servers, attempts and the wait: a manager's line. Anyone else gets
// the chat's own wording, which is not built here and names nothing.
const { toolView } = useAgentToolState(agent, canManage);

const restarting = ref(false);
const restartError = ref<string | null>(null);
const restartFailed = ref(false);

// The launch as a list of steps (CLEAN-247): which one the agent is really
// on, read from reported facts, in place of a sentence picked by how many
// seconds had gone by. `isTransitioning` is the same signal as before, the
// restart call out or the status on its way, now owned by the composable.
const {
  launch,
  visible: launchVisible,
  transitioning: isTransitioning,
  expectLaunch,
} = useAgentLaunch(props.id, agent, restarting);

/**
 * What the chat's queue is told about the agent (CLEAN-245): on its way up
 * the messages wait and go out by themselves; failed or stopped they are
 * kept and the person is asked. Null: running, as far as this page knows.
 */
const queueAgentState = computed(() => {
  if (isTransitioning.value) return 'starting' as const;
  if (agent.value?.status === 'failed') return 'failed' as const;
  if (agent.value?.status === 'stopped') return 'stopped' as const;
  return null;
});

async function onRestart() {
  if (!agent.value || restarting.value) return;
  // Read before the store flips the status optimistically.
  expectLaunch(agent.value.status);
  restarting.value = true;
  restartError.value = null;
  restartFailed.value = false;
  // The optimistic 'deploying' flip — overlay appears immediately, status
  // pill animates — and its rollback happen inside `agentStore.restart`, on
  // the one store record, so the rail row flips with this header.
  try {
    await agentStore.restart(agent.value.id);
    await refresh();
  } catch (err) {
    restartFailed.value = true;
    // A 401 the api plugin could not recover from is the session-ended
    // dialog's story to tell, so the banner says `chat.restart_failed` alone
    // rather than echoing a raw auth string (CLEAN-72). Any other detail is
    // shown after it exactly as received.
    const status = (err as { response?: { status?: number } } | null)
      ?.response?.status;
    restartError.value =
      status === 401 ? null : (err as Error).message || null;
  } finally {
    restarting.value = false;
  }
}

// Poll status while the agent is in a transitional state. Stops automatically
// once it's running / failed / stopped. 3s feels responsive without hammering
// the API; matches admin's flow (which uses 5s but also has SSE for finer detail).
let statusTimer: ReturnType<typeof setInterval> | null = null;
function clearStatusTimer() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

watch(
  isTransitioning,
  (active) => {
    if (active) {
      if (!statusTimer) statusTimer = setInterval(() => refresh(), 3000);
    } else {
      clearStatusTimer();
    }
  },
  { immediate: true },
);
onBeforeUnmount(clearStatusTimer);

// Status meta for the small pill in the header.
const statusMeta = computed(() => {
  const status = agent.value?.status;
  switch (status) {
    case 'running':
      return { labelKey: 'status.running', label: status, dot: 'bg-emerald-500', pulse: true };
    case 'deploying':
      return { labelKey: 'status.deploying', label: status, dot: 'bg-amber-500', pulse: true };
    case 'pending':
      return { labelKey: 'status.pending', label: status, dot: 'bg-amber-500', pulse: true };
    case 'failed':
      return { labelKey: 'status.failed', label: status, dot: 'bg-rose-500', pulse: false };
    case 'unreachable':
      return { labelKey: 'status.unreachable', label: status, dot: 'bg-orange-500', pulse: false };
    case 'stopped':
      return { labelKey: 'status.stopped', label: status, dot: 'bg-muted-foreground', pulse: false };
    default:
      // No wording for a status the runtime invented — show it as received.
      return { labelKey: null, label: status ?? '', dot: 'bg-muted-foreground', pulse: false };
  }
});

const initials = computed(() => {
  const source = agent.value?.name?.trim() || agent.value?.id || '?';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || '?';
});
</script>

<template>
  <!-- Height comes from the workspace shell now: this component is one
       column of it, not the page. -->
  <div class="flex h-full min-h-0 flex-col">
    <!-- Compact header strip: agent identity, status, actions. The "back to
         agents" link is gone with the card grid it pointed at — the rail on
         the left is where you switch agents now. -->
    <header v-if="!compact" class="shrink-0 border-b bg-card/60 backdrop-blur">
      <!-- `relative` anchors the share popover to the header strip. -->
      <div
        class="relative mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
        <div
          v-if="agent"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-linear-to-br from-[#4a3356] to-[#251b2b] text-sm font-semibold text-foreground"
        >
          {{ initials }}
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h1 class="truncate text-sm font-semibold">
              <template v-if="agent">{{ agent.name }}</template>
              <template v-else-if="waiting">{{ $t('chat.loading') }}</template>
              <template v-else>{{ $t('chat.not_found') }}</template>
            </h1>
            <span
              v-if="agent"
              class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              <span class="relative flex h-1.5 w-1.5">
                <span
                  v-if="statusMeta.pulse"
                  class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
                  :class="statusMeta.dot"
                />
                <span
                  class="relative inline-flex h-1.5 w-1.5 rounded-full"
                  :class="statusMeta.dot"
                />
              </span>
              {{ statusMeta.labelKey ? $t(statusMeta.labelKey) : statusMeta.label }}
            </span>
            <span
              v-if="toolView"
              class="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              :data-tool-state="toolView.kind"
            >
              {{ $t(toolView.labelKey) }}
            </span>
          </div>
          <p
            v-if="agent"
            class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
            :title="agent.templateId"
          >
            {{ agent.templateId }}
          </p>
        </div>
        </div>

        <!-- Actions: one row that scrolls sideways on a phone instead of
             wrapping the title out of the way. -->
        <div class="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:overflow-x-auto max-sm:pb-0.5 [&>*]:shrink-0">
        <!-- Anyone talking to the agent may start their conversation over
             (CLEAN-136). The descriptor is the chat's own default below. -->
        <BridleChatNewChat v-if="conversation" :conversation="conversation" />

        <!-- No `canManage` gate: any logged-in user who can open the agent may
             share it (spec clarification, 2026-09-07). The Ranch assistant
             apart, whose link is the Owner's (`canShareAgent`, CLEAN-269). -->
        <SharePanelProvider v-if="agent && canShare" :agent-id="agent.id" />

        <button
          v-if="agent && canManage"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 transition"
          :disabled="isTransitioning"
          @click="onRestart"
        >
          <Icon
            :name="isTransitioning ? 'loader-2' : 'refresh-cw'"
            :size="13"
            :class="isTransitioning ? 'animate-spin' : undefined"
          />
          {{ $t(isTransitioning ? 'chat.restarting' : 'chat.restart') }}
        </button>
        </div>
      </div>
    </header>

    <div
      v-if="restartFailed && !compact"
      class="shrink-0 border-b bg-rose-500/10"
    >
      <p
        class="mx-auto w-full max-w-3xl px-4 py-2 text-xs text-rose-700 dark:text-rose-400"
      >
        {{ $t('chat.restart_failed') }}<template v-if="restartError">: {{ restartError }}</template>
      </p>
    </div>

    <!-- Chat — expands to fill remaining height -->
    <div class="relative flex-1 min-h-0 overflow-hidden bg-[radial-gradient(60%_40%_at_50%_0%,rgba(245,161,107,0.07),transparent_70%)]">
      <div
        v-if="!agent && !waiting"
        class="flex h-full flex-col items-center justify-center gap-3 text-center px-4"
        data-chat-unavailable
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon name="bot-off" :size="22" />
        </div>
        <div>
          <p class="text-sm font-medium">{{ $t('chat.unavailable_title') }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ $t('chat.unavailable_hint') }}
          </p>
        </div>
      </div>
      <!-- By the id of the address, not the record's: the same chat stands
           while the record is on its way and after it has come, so nothing
           is mounted twice and the socket is asked for once. -->
      <BridleChatProvider
        v-else
        :agent-id="id"
        :title="agent?.name"
        :subtitle="agent?.templateId"
        :show-header="false"
        :tool-view="toolView"
        :agent-state="queueAgentState"
      >
      <!-- Launch overlay — covers the transcript while the pod is bouncing,
           never the composer: what is written meanwhile waits in the queue
           (CLEAN-245). Shown during the API call and while the status is in
           a transitional state (deploying/pending), as before; it now holds
           the launch's step list (CLEAN-247), stays a moment on the completed
           list, and stays on a launch that failed. -->
      <template #overlay>
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-all duration-300 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="launch && launchVisible"
          :data-chat-overlay="launch.view.outcome === 'failed' ? 'failed' : 'starting'"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm"
        >
          <AgentLaunchSteps
            :launch="launch"
            :can-manage="canManage"
            :restarting="isTransitioning"
            @restart="onRestart"
          />
        </div>
      </Transition>
      </template>
      </BridleChatProvider>
    </div>
  </div>
</template>
