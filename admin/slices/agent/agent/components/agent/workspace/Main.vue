<script setup lang="ts">
import { useTimeAgoIntl } from '@vueuse/core';
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconLoader2,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconShield,
  IconTool,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { useToolCatalogStore } from '#toolCatalog/stores/toolCatalog';
import { agentInitials } from '#agent/composables/useAgentRailEntries';
import { useAgentSectionCounts } from '#agent/composables/useAgentSectionCounts';
import { useAgentTab } from '#agent/composables/useAgentTab';
import { workspaceTabOf } from './sections';

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
//
// The request is here for `pending` and `refresh` only. What renders is the
// store's record (docs/state.md) — the same object the rail row shows, so the
// two cannot disagree; `fetchById` upserts into it.
const { pending, refresh } = useAsyncData(
  `admin-agent-${props.id}`,
  () => agentStore.fetchById(props.id),
  { lazy: true },
);
const agent = computed(() => agentStore.byId(props.id));

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

// The Settings hub's cards show counts before you click, so there is nothing
// to gate them behind — they are fetched from first paint.
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

// Fetches and status-stream frames both land in the one store record, so
// there is no "live vs fetched" to pick between any more.
const agentStatusStore = useAgentStatusStore();
const displayStatus = computed(() => agent.value?.status ?? 'pending');
const statusReason = computed(() => agent.value?.statusReason ?? null);
// `=== false` on purpose: undefined means the stream hasn't reported yet.
const runtimeOffline = computed(
  () =>
    displayStatus.value === 'running' &&
    agentStatusStore.bridleConnected[props.id] === false,
);

const lifecycleError = computed(() => restartError.value || toggleError.value);

// "restarted 2m ago" (CLEAN-59), now in the status dot's tooltip (specs/017):
// the colour alone can't tell the operator a restart actually happened — launchContext is historical ("why the LAST
// deploy ran", stays 'restart' forever after the first restart) and the
// deploying phase lasts seconds, so a snapshot look always lands on
// status=running. The moment of the last deploy is the missing piece.
// A restart triggered anywhere (Files-tab banner, rancher, another tab)
// reaches the store record through the status stream, so the hint updates
// without a page reload.
const lastDeployStartedAt = computed(
  () => agent.value?.lastDeployStartedAt ?? null,
);
const launchContext = computed(() => agent.value?.launchContext ?? null);
const lastPullAt = computed(() => agent.value?.lastPullAt ?? null);
const { locale } = useI18n();
const deployAgo = useTimeAgoIntl(
  () => new Date(lastDeployStartedAt.value ?? Date.now()),
  { locale: locale.value },
);
const deployVerb = computed(() =>
  launchContext.value === 'restart' ? 'restarted' : 'started',
);
const deployHintTitle = computed(() => {
  if (!lastDeployStartedAt.value) return undefined;
  const parts = [
    `Last deploy started ${formatDateTime(lastDeployStartedAt.value)}`,
  ];
  // lastPullAt = the NEW pod registered and took its S3 file copy — the
  // definitive "restart completed and files picked up" proof.
  if (lastPullAt.value)
    parts.push(`files picked up ${formatDateTime(lastPullAt.value)}`);
  return parts.join(' · ');
});

// Tools opens the catalogue sheet, which the chat composer mounts — and the
// chat stays mounted behind Settings, so this works from any tab.
const toolCatalogStore = useToolCatalogStore();

// Delete sits last in the menu, behind a separator: it is the one action
// there you cannot undo, and it should not sit one mis-click away from the
// ones you reach for most.
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
      <!-- One header row (specs/017): identity with its status folded into a
           dot on the avatar, the two workspace tabs, then the lifecycle on the
           right. The status word, its reason and "restarted 2m ago" live in
           the dot's tooltip; only warnings stay as visible text. -->
      <div
        class="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border/70 pb-3"
      >
        <span class="relative shrink-0">
          <span
            class="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
          >
            {{ initials }}
          </span>
          <AgentStatusDot
            class="absolute -bottom-0.5 -right-0.5"
            :status="displayStatus"
            :status-reason="statusReason"
            :deploy-verb="lastDeployStartedAt ? deployVerb : null"
            :deploy-ago="lastDeployStartedAt ? deployAgo : null"
            :deploy-hint-title="deployHintTitle"
          />
        </span>
        <h1 class="min-w-0 truncate text-base font-semibold">{{ agent.name }}</h1>
        <IconShield
          v-if="agent.isAdmin"
          class="size-4 shrink-0 text-primary"
          title="This agent has the ranch_* admin tools and a service token"
        />
        <span
          v-if="runtimeOffline"
          class="shrink-0 text-xs text-orange-600 dark:text-orange-400"
          title="Pod is up but the runtime hasn't connected to the bridle hub yet"
        >
          runtime offline
        </span>

        <AgentWorkspaceTabs
          class="ml-2"
          :active="workspaceTabOf(tab)"
          @select="setTab"
        />

        <div class="flex-1" />

        <!-- One line of usage; the figures open on click (specs/017, R3).
             Below ~900px it wraps under the tabs (`order-last basis-full`)
             so Stop and the menu never leave the row. -->
        <UsageLine
          :agent-id="agent.id"
          class="order-last basis-full md:order-none md:basis-auto md:max-w-72"
          @details="setTab('overview')"
        />

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
          <!-- Everything but Stop/Start lives in the menu (specs/017, R6):
               Restart, Tools, Edit, Share as a submenu of rows, and Delete
               last, separated — the one action here you cannot undo. -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="size-8 p-0">
                <span class="sr-only">More agent actions</span>
                <IconDotsVertical class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-44">
              <DropdownMenuItem
                class="cursor-pointer"
                :disabled="isRestarting || toggling"
                @select="restart"
              >
                <IconLoader2 v-if="isRestarting" class="size-4 animate-spin" />
                <IconRefresh v-else class="size-4" />
                {{ isRestarting ? 'Restarting…' : 'Restart' }}
              </DropdownMenuItem>
              <DropdownMenuItem
                class="cursor-pointer"
                title="What this agent can do — click a tool to drop a starter prompt into the chat"
                @select="toolCatalogStore.openSheet(agent.id)"
              >
                <IconTool class="size-4" />
                Tools
              </DropdownMenuItem>
              <DropdownMenuItem as-child class="cursor-pointer">
                <NuxtLink :to="`/agents/${agent.id}/edit`">
                  <IconPencil class="size-4" />
                  Edit
                </NuxtLink>
              </DropdownMenuItem>
              <ShareMenuSub :agent-id="agent.id" />
              <DropdownMenuSeparator />
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

      <div class="min-h-0 flex-1">
        <AgentWorkspaceCanvas
          :agent="agent"
          :api-url="apiUrl"
          :tab="tab"
          :counts="counts"
          :overlay="chatOverlay"
          :restarting="isRestarting"
          :toggling="toggling"
          @restart="restart"
          @toggle-running="toggleRunning"
          @set-tab="setTab"
          @agent-updated="(updated) => agentStore.upsert(updated)"
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
