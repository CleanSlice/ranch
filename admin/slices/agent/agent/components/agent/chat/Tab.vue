<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core';
import type { IAgentData } from '#agent/domain';
import type { ChatOverlay } from '#agent/composables/useAgentLifecycle';
import type { IToolStateView } from '#agent/utils/toolState';
import { useAgentAccess } from '#agent/composables/useAgentAccess';
import {
  IconAlertTriangle,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-vue';

const props = withDefaults(
  defineProps<{
    agent: IAgentData;
    apiUrl: string;
    overlay: ChatOverlay;
    /** The agent's tool-server mark (CLEAN-245); null when there is none. */
    toolView?: IToolStateView | null;
    restarting: boolean;
    toggling: boolean;
    /** False while another tab is on screen. The chat itself stays mounted
     *  (v-show) so its socket and transcript survive, but the logs bar must
     *  not keep polling behind Settings or behind the full-width Logs
     *  section showing the same thing. */
    active?: boolean;
  }>(),
  { active: true, toolView: null },
);

const emit = defineEmits<{ restart: []; toggleRunning: [] }>();

const authStore = useAuthStore();

// The conversation is for anybody who can open the agent; what manages the
// agent from inside it is not (CLEAN-232). For a viewer who may not manage
// this agent the pod logs, the Start and Restart buttons of the overlay, the
// chat's own restart prompt and Debug toggle, and the troubleshooting links
// into Environment are left out — each is a request the API would refuse.
const { canManage } = useAgentAccess(() => props.agent);

// One "restart is underway" signal for every surface (bridle header status,
// the queue that holds what is written meanwhile — CLEAN-245, logs overlay) — covers both an explicit Restart click and
// a deploy in progress, so nothing lags behind the WS state.
const restartUnderway = computed(
  () => props.restarting || props.overlay?.kind === 'starting',
);

// Reconciled agent state for the bridle header — without it a failed agent
// reads as "Agent reconnecting…" for 30s on a freshly opened page, because
// bridle only sees its own WS.
const agentStatusStore = useAgentStatusStore();
// `props.agent` is the store record, which the status stream writes into —
// the drift sweep's 'running' → 'unreachable' arrives here by itself.
const displayStatus = computed(() => props.agent.status);

const bridleAgentState = computed(() => {
  if (restartUnderway.value) return 'restarting';
  if (props.overlay?.kind === 'failed') return 'failed';
  if (props.overlay?.kind === 'stopped') return 'stopped';
  if (props.overlay?.kind === 'tools') return 'connecting';
  if (displayStatus.value === 'unreachable') return 'unreachable';
  return null;
});

// Troubleshooting links for the "pod is up but the runtime never reached the
// hub" state: the sweep's statusReason plus where to look (env preview shows
// the missing BRIDLE_* vars) and where to fix it (/settings/bridle).
//
// The banner reads as an accusation that the bridle setup is broken, so it only
// goes out on the server's verdict, confirmed twice: the drift sweep demoted
// this agent to `unreachable` (a Running+Ready pod that stayed off the hub past
// the grace window), and the live hub map still does not list its runtime. A
// chat socket that simply hasn't heard `agent_status` yet — every page load,
// every reconnect, every restart — no longer qualifies. `!== true` rather than
// `=== false` so a stream that hasn't reported this agent yet cannot silently
// swallow a real incident.
const hubUnreachable = computed(
  () =>
    displayStatus.value === 'unreachable' &&
    agentStatusStore.bridleConnected[props.agent.id] !== true,
);

// Running without some of its tools: a line above the composer, nothing
// blocked. While they are still being reached the overlay says it instead.
const toolNotice = computed(() =>
  props.toolView?.kind === 'limited'
    ? { label: props.toolView.label, detail: props.toolView.detail }
    : null,
);

const offlineHint = computed(() =>
  hubUnreachable.value && canManage.value
    ? {
        reason: props.agent.statusReason,
        envHref: `/agents/${props.agent.id}?tab=env`,
        settingsHref: '/settings/bridle',
      }
    : null,
);

// The failure overlay blurs only the MESSAGE AREA (the card-content box).
// Footer (the input, open whatever the agent is doing, and its queue) and the logs bar
// stay visible — the user keeps the frame and the controls, only the
// transcript is dimmed. The box is measured from the DOM because the footer
// height is content-driven.
const chatWrapRef = ref<HTMLElement | null>(null);
const overlayBox = ref({ top: 0, right: 0, bottom: 0, left: 0 });

function measureOverlayBox() {
  const wrap = chatWrapRef.value;
  const content = wrap?.querySelector('[data-slot="card-content"]');
  if (!wrap || !content) return;
  const w = wrap.getBoundingClientRect();
  const c = content.getBoundingClientRect();
  overlayBox.value = {
    top: c.top - w.top,
    right: w.right - c.right,
    bottom: w.bottom - c.bottom,
    left: c.left - w.left,
  };
}

// The column's width changes with the rail, the window and the Settings
// round trip; a box measured once at mount would drift.
useResizeObserver(chatWrapRef, measureOverlayBox);
// The footer grows without the column changing size: a queued message adds a
// row, and the overlay must give that height back (CLEAN-245).
const messageAreaRef = ref<HTMLElement | null>(null);
watch(
  chatWrapRef,
  (wrap) => {
    messageAreaRef.value =
      wrap?.querySelector<HTMLElement>('[data-slot="card-content"]') ?? null;
    measureOverlayBox();
  },
  { immediate: true, flush: 'post' },
);
useResizeObserver(messageAreaRef, measureOverlayBox);
watch(
  () => props.overlay,
  async (o) => {
    if (o) {
      await nextTick();
      measureOverlayBox();
    }
  },
);
</script>

<template>
  <!-- One column (specs/017): the conversation takes the whole width the
       workspace canvas gives it, frameless, with the pod logs as a bar under
       the composer. The bar is `v-if="active"` so its poller stops the moment
       another tab covers the chat — the chat itself stays mounted behind it. -->
  <div class="flex h-full min-h-0 min-w-0 flex-col gap-2.5">
    <div
      v-if="authStore.isAuthenticated"
      ref="chatWrapRef"
      class="relative min-h-0 w-full min-w-0 flex-1"
    >
      <BridleProvider
        :api-url="apiUrl"
        :agent-id="agent.id"
        :title="`Chat with ${agent.name}`"
        :restart-prompt="false"
        :tools-button="false"
        :manageable="canManage"
        frameless
        :agent-state="bridleAgentState"
        :offline-hint="offlineHint"
        :tool-notice="toolNotice"
        :initial-debug-enabled="agent.debugEnabled"
        class="h-full w-full gap-0"
      />
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="overlay"
          :data-chat-overlay="overlay.kind"
          class="pointer-events-auto absolute z-10 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm"
          :style="{
            top: overlayBox.top + 'px',
            right: overlayBox.right + 'px',
            bottom: overlayBox.bottom + 'px',
            left: overlayBox.left + 'px',
          }"
        >
          <!-- A launch is a list of steps (CLEAN-247): the same overlay, the
               same place, with what the agent has really got through. -->
          <AgentLaunchSteps
            v-if="'launch' in overlay && overlay.launch"
            :launch="overlay.launch"
            :can-manage="canManage"
            :restarting="restarting"
            @restart="emit('restart')"
          />
          <template v-else>
          <IconLoader2
            v-if="overlay.kind === 'starting' || overlay.kind === 'tools'"
            class="size-10 animate-spin text-primary"
          />
          <IconPlayerStop
            v-else-if="overlay.kind === 'stopped'"
            class="size-10 text-muted-foreground"
          />
          <IconAlertTriangle v-else class="size-10 text-destructive" />
          <div class="max-w-sm text-center">
            <p class="text-sm font-medium">{{ overlay.title }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ overlay.detail }}</p>
          </div>
          <Button
            v-if="overlay.kind === 'stopped' && canManage"
            size="sm"
            :disabled="toggling"
            @click="emit('toggleRunning')"
          >
            <IconLoader2 v-if="toggling" class="size-4 animate-spin" />
            <IconPlayerPlay v-else class="size-4" />
            {{ toggling ? 'Starting…' : 'Start agent' }}
          </Button>
          <Button
            v-if="overlay.kind === 'failed' && canManage"
            size="sm"
            :disabled="restarting"
            @click="emit('restart')"
          >
            <IconLoader2 v-if="restarting" class="size-4 animate-spin" />
            <IconRefresh v-else class="size-4" />
            {{ restarting ? 'Restarting…' : 'Restart agent' }}
          </Button>
          </template>
        </div>
      </Transition>
    </div>

    <AgentLogsBar
      v-if="active && canManage"
      :agent-id="agent.id"
      :restarting="restartUnderway"
      :first-start="agent.launchContext === 'initial'"
      class="mx-auto w-full max-w-5xl shrink-0"
    />
  </div>
</template>
