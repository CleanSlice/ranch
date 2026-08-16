<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import type { ChatOverlay } from '#agent/composables/useAgentLifecycle';
import {
  IconAlertTriangle,
  IconFileText,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-vue';

const props = defineProps<{
  agent: IAgentData;
  apiUrl: string;
  overlay: ChatOverlay;
  restarting: boolean;
  toggling: boolean;
}>();

const emit = defineEmits<{ restart: []; toggleRunning: [] }>();

const authStore = useAuthStore();

// Side column next to the chat: logs fill the full height (usage lives in
// the page-level header strip). The logs panel is only mounted while open,
// so its 5s polling stops the moment it's collapsed.
const showSideLogs = ref(true);

// One "restart is underway" signal for every surface (bridle header status,
// disabled input, logs overlay) — covers both an explicit Restart click and
// a deploy in progress, so nothing lags behind the WS state.
const restartUnderway = computed(
  () => props.restarting || props.overlay?.kind === 'starting',
);

// Reconciled agent state for the bridle header — without it a failed agent
// reads as "Agent reconnecting…" for 30s on a freshly opened page, because
// bridle only sees its own WS.
const bridleAgentState = computed(() => {
  if (restartUnderway.value) return 'restarting';
  if (props.overlay?.kind === 'failed') return 'failed';
  if (props.overlay?.kind === 'stopped') return 'stopped';
  return null;
});

// The failure overlay blurs only the MESSAGE AREA (the card-content box).
// Header (title, status, Logs toggle), footer (input, disabled by bridle
// while the agent is down) and the card border all stay visible — the user
// keeps the frame and the controls, only the transcript is dimmed. The box is
// measured from the DOM because header/footer heights are content-driven.
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

onMounted(measureOverlayBox);
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
  <div class="flex items-center justify-center gap-3">
    <div
      v-if="authStore.accessToken"
      ref="chatWrapRef"
      class="relative h-[calc(100vh-15.5rem)] min-h-120 w-full min-w-100 max-w-200 basis-1/2"
    >
      <BridleProvider
        :api-url="apiUrl"
        :agent-id="agent.id"
        :token="authStore.accessToken"
        :title="`Chat with ${agent.name}`"
        :restart-prompt="false"
        :agent-state="bridleAgentState"
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
          class="pointer-events-auto absolute z-10 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm"
          :style="{
            top: overlayBox.top + 'px',
            right: overlayBox.right + 'px',
            bottom: overlayBox.bottom + 'px',
            left: overlayBox.left + 'px',
          }"
        >
          <IconLoader2
            v-if="overlay.kind === 'starting'"
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
            v-if="overlay.kind === 'stopped'"
            size="sm"
            :disabled="toggling"
            @click="emit('toggleRunning')"
          >
            <IconLoader2 v-if="toggling" class="size-4 animate-spin" />
            <IconPlayerPlay v-else class="size-4" />
            {{ toggling ? 'Starting…' : 'Start agent' }}
          </Button>
          <Button
            v-if="overlay.kind === 'failed'"
            size="sm"
            :disabled="restarting"
            @click="emit('restart')"
          >
            <IconLoader2 v-if="restarting" class="size-4 animate-spin" />
            <IconRefresh v-else class="size-4" />
            {{ restarting ? 'Restarting…' : 'Restart agent' }}
          </Button>
        </div>
      </Transition>
    </div>
    <div
      class="flex h-[calc(100vh-15.5rem)] min-h-120 w-full max-w-200 basis-1/2 flex-col gap-1"
    >
      <div v-if="showSideLogs" class="min-h-0 flex-1 overflow-hidden">
        <AgentLogsPanel
          :agent-id="agent.id"
          closable
          :restarting="restartUnderway"
          :first-start="agent.launchContext === 'initial'"
          class="h-full min-w-100"
          @close="showSideLogs = false"
        />
      </div>
      <Button
        v-else
        variant="outline"
        size="sm"
        class="self-start"
        title="Show pod logs"
        @click="showSideLogs = true"
      >
        <IconFileText class="size-4" />
        Logs
      </Button>
    </div>
  </div>
</template>
