<script setup lang="ts">
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconShield,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { agentInitials } from '#agent/composables/useAgentRailEntries';
import { useAgentSectionCounts } from '#agent/composables/useAgentSectionCounts';
import { useAgentTab } from '#agent/composables/useAgentTab';

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

const { tab, setTab } = useAgentTab();

// The tab bar shows counts before you click, so unlike the old settings panel
// there is nothing to gate them behind — they are on screen from first paint.
const { counts } = useAgentSectionCounts(props.id, agent);

// The status badge renders from the DB row (not the SSE pod stream). Re-fetch
// when the operator opens Overview so a stale 'failed' or 'deploying' from
// initial load doesn't outlive the reconciled state.
watch(tab, (t) => {
  if (t === 'overview') void refresh();
});

const initials = computed(() =>
  agent.value ? agentInitials(agent.value.name, agent.value.id) : '?',
);

const lifecycleError = computed(() => restartError.value || toggleError.value);

// Delete lives in the overflow menu rather than beside Edit: it is the one
// action in this row you cannot undo, and it should not sit one mis-click
// away from the one you reach for most.
const confirmRemoveOpen = ref(false);
const removing = ref(false);
const removeError = ref<string | null>(null);

async function onRemove() {
  if (!agent.value || removing.value) return;
  removing.value = true;
  removeError.value = null;
  try {
    await agentStore.remove(agent.value.id);
    emit('deleted');
  } catch (err) {
    removeError.value = (err as Error).message || 'Delete failed';
  } finally {
    removing.value = false;
  }
}
</script>

<template>
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
      <Skeleton class="h-9 w-full shrink-0" />
      <Skeleton class="h-9 w-full shrink-0" />
      <Skeleton class="min-h-0 w-full flex-1" />
    </div>

    <template v-else-if="agent">
      <!-- Identity on the left, the agent's lifecycle on the right. -->
      <div class="flex shrink-0 items-center gap-2.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
        >
          {{ initials }}
        </span>
        <h1 class="truncate text-base font-semibold">{{ agent.name }}</h1>
        <IconShield
          v-if="agent.isAdmin"
          class="size-4 shrink-0 text-primary"
          title="This agent has the ranch_* admin tools and a service token"
        />
        <Badge
          :variant="AGENT_STATUS_VARIANT[agent.status]"
          class="shrink-0 capitalize"
        >
          {{ agent.status }}
        </Badge>

        <div class="flex-1" />

        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="toggling || isRestarting"
            :title="
              canStop
                ? 'Cancel the workflow and delete the pod to free cluster resources'
                : 'Deploy a fresh pod'
            "
            @click="toggleRunning"
          >
            <IconLoader2 v-if="toggling" class="size-4 animate-spin" />
            <IconPlayerStop v-else-if="canStop" class="size-4" />
            <IconPlayerPlay v-else class="size-4" />
            {{
              toggling
                ? canStop
                  ? 'Stopping…'
                  : 'Starting…'
                : canStop
                  ? 'Stop'
                  : 'Start'
            }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="isRestarting || toggling"
            @click="restart"
          >
            <IconLoader2 v-if="isRestarting" class="size-4 animate-spin" />
            <IconRefresh v-else class="size-4" />
            {{ isRestarting ? 'Restarting…' : 'Restart' }}
          </Button>
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="size-8 p-0">
                <span class="sr-only">More agent actions</span>
                <IconDotsVertical class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                class="cursor-pointer text-destructive focus:text-destructive"
                :disabled="removing"
                @select="confirmRemoveOpen = true"
              >
                <IconTrash class="size-4" />
                Delete agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p
        v-if="lifecycleError || removeError"
        class="shrink-0 text-xs text-destructive"
      >
        {{ lifecycleError || removeError }}
      </p>

      <!-- Usage strip sits with the identity above it and the tabs below, so
           the tab bar stays directly attached to the content it switches. -->
      <UsagePanel
        :agent-id="agent.id"
        agent-only
        variant="strip"
        class="shrink-0"
        @details="setTab('overview')"
      />

      <AgentWorkspaceTabs :active="tab" :counts="counts" @select="setTab" />

      <div class="min-h-0 flex-1">
        <AgentWorkspaceCanvas
          :agent="agent"
          :api-url="apiUrl"
          :tab="tab"
          :overlay="chatOverlay"
          :restarting="isRestarting"
          :toggling="toggling"
          @restart="restart"
          @toggle-running="toggleRunning"
          @agent-updated="(updated) => (agent = updated)"
        />
      </div>

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Delete agent"
        :description="`Permanently delete agent “${agent.name}”? This cannot be undone.`"
        confirm-label="Delete agent"
        :busy="removing"
        @confirm="onRemove"
      />
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Agent not found.
    </div>
  </div>
</template>
