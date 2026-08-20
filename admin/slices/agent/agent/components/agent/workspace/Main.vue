<script setup lang="ts">
import {
  IconAlertTriangle,
  IconRefresh,
  IconSettings,
  IconX,
} from '@tabler/icons-vue';
import { useMediaQuery } from '@vueuse/core';
import { agentInitials } from '#agent/composables/useAgentRailEntries';
import { useAgentSectionCounts } from '#agent/composables/useAgentSectionCounts';
import { useSettingsPanel } from '#agent/composables/useSettingsPanel';
import type { AgentSettingsSection } from '#agent/components/agent/settings/sections';

const props = defineProps<{ id: string }>();

const emit = defineEmits<{ deleted: [] }>();

const agentStore = useAgentStore();
const config = useRuntimeConfig();

const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

// Loaded lazily so the route transitions immediately and the skeleton renders
// until the data arrives. Without lazy, top-level awaits in <script setup>
// block the Vue Router transition until every promise resolves — the user
// perceives this as a multi-second delay before the page opens.
const { data: agent, pending, refresh } = useAsyncData(
  `admin-agent-${props.id}`,
  () => agentStore.fetchById(props.id),
  { lazy: true },
);

const {
  isRestarting,
  restartError,
  restart,
  canStop,
  toggling,
  toggleError,
  toggleRunning,
  pendingRestart,
  dismissRestartBanner,
  chatOverlay,
} = useAgentLifecycle(props.id, agent, refresh);

const { section, open: panelOpen, setSection, setOpen, close } =
  useSettingsPanel();

// ── Where the panel renders ──────────────────────────────────────────
// One instance, three appearances — docking is pure CSS (see the classes on
// the <aside> below), so crossing a breakpoint never remounts the panel or
// duplicates its state.
//
// The one thing CSS cannot decide is whether it starts open: on a phone there
// is no room to have it open beside anything, so it is on-demand there
// regardless of the stored preference.
const isNarrow = useMediaQuery('(max-width: 1023px)');
const narrowPanelOpen = ref(false);

const panelVisible = computed(() =>
  isNarrow.value ? narrowPanelOpen.value : panelOpen.value,
);

// Counts stay cold until the navigator is actually visible.
const { counts } = useAgentSectionCounts(props.id, agent, panelVisible);

function onManage() {
  if (isNarrow.value) narrowPanelOpen.value = true;
  else setOpen(true);
}

function onSelectSection(next: AgentSettingsSection | null) {
  setSection(next);
  // On a phone the panel covers the canvas it just navigated to.
  if (isNarrow.value) narrowPanelOpen.value = false;
}

function onClosePanel() {
  if (isNarrow.value) narrowPanelOpen.value = false;
  else close();
}

// The status badge in the panel renders from the DB row (not the SSE pod
// stream). Re-fetch when the operator opens Overview so a stale 'failed' or
// 'deploying' from initial load doesn't outlive the reconciled state.
watch(section, (s) => {
  if (s === 'overview') void refresh();
});

const initials = computed(() =>
  agent.value ? agentInitials(agent.value.name, agent.value.id) : '?',
);

const lifecycleError = computed(() => restartError.value || toggleError.value);
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 gap-4">
    <!-- Middle column: banner, compact identity, usage strip, canvas. -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div
        v-if="pendingRestart"
        class="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
      >
        <IconAlertTriangle class="size-4 shrink-0" />
        <p class="min-w-56 flex-1">
          Agent settings were updated. Restart the agent to apply the changes.
        </p>
        <div class="flex items-center gap-2">
          <Button size="sm" :disabled="isRestarting" @click="restart">
            <IconRefresh class="size-4" :class="isRestarting && 'animate-spin'" />
            {{ isRestarting ? 'Restarting…' : 'Restart agent' }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="isRestarting"
            @click="dismissRestartBanner"
          >
            <IconX class="size-4" />
          </Button>
        </div>
      </div>

      <div v-if="pending && !agent" class="flex min-h-0 flex-1 flex-col gap-3">
        <Skeleton class="h-8 w-full shrink-0" />
        <Skeleton class="h-9 w-full shrink-0" />
        <Skeleton class="min-h-0 w-full flex-1" />
      </div>

      <template v-else-if="agent">
        <!-- Compact header. The lifecycle buttons that used to live here are
             in the settings panel now (FR-009); what stays is identity and
             the way back to it. -->
        <div class="flex shrink-0 items-center gap-2.5">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
          >
            {{ initials }}
          </span>
          <h1 class="truncate text-base font-semibold">{{ agent.name }}</h1>
          <Badge
            :variant="AGENT_STATUS_VARIANT[agent.status]"
            class="shrink-0 capitalize"
          >
            {{ agent.status }}
          </Badge>
          <div class="flex-1" />
          <Button
            v-if="!panelVisible"
            variant="outline"
            size="sm"
            @click="onManage"
          >
            <IconSettings class="size-4" />
            Manage agent
          </Button>
        </div>

        <!-- Full-width usage strip under the header: visible in both canvas
             modes; Details opens the Overview section. -->
        <UsagePanel
          :agent-id="agent.id"
          agent-only
          variant="strip"
          class="shrink-0"
          @details="onSelectSection('overview')"
        />

        <div class="min-h-0 flex-1">
          <AgentWorkspaceCanvas
            :agent="agent"
            :api-url="apiUrl"
            :section="section"
            :overlay="chatOverlay"
            :restarting="isRestarting"
            :toggling="toggling"
            @restart="restart"
            @toggle-running="toggleRunning"
            @back="onSelectSection(null)"
            @agent-updated="(updated) => (agent = updated)"
          />
        </div>
      </template>

      <div
        v-else
        class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
      >
        Agent not found.
      </div>
    </div>

    <!-- The navigator. One element, two appearances, decided by CSS:
         · ≥1024px — a real column in the flex row. It takes space rather than
           floating over the canvas: floating looked tidy in the abstract, but
           in practice it covered the pod logs and left the chat card clipped
           at the right edge. The chat/logs pair shrinks to make room instead
           (see chat/Tab.vue), which is the behaviour that keeps every border
           where the eye expects it.
         · <1024px — the whole screen, because there is no room beside it.
         Width and placement are the host's business; the panel itself does
         not know where it lives. -->
    <aside
      v-if="agent && panelVisible"
      class="w-80 shrink-0 overflow-hidden rounded-lg border bg-card max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:w-full max-lg:rounded-none"
    >
      <AgentSettingsPanel
        :agent="agent"
        :section="section"
        :counts="counts"
        :can-stop="canStop"
        :toggling="toggling"
        :is-restarting="isRestarting"
        :lifecycle-error="lifecycleError"
        @update:section="onSelectSection"
        @restart="restart"
        @toggle-running="toggleRunning"
        @close="onClosePanel"
        @deleted="emit('deleted')"
      />
    </aside>
  </div>
</template>
