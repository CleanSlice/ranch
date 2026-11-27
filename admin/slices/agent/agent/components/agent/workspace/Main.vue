<script setup lang="ts">
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconLoader2,
  IconPin,
  IconPinnedOff,
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
import { useAgentAccess } from '#agent/composables/useAgentAccess';
import { provideAgentDelete } from '#agent/composables/useAgentDelete';
import { useAgentPin } from '#agent/composables/useAgentPin';
import { useAgentSectionCounts } from '#agent/composables/useAgentSectionCounts';
import { useAgentTab } from '#agent/composables/useAgentTab';
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDateTime } from '#common/utils/format';
import { OWNER_MANAGED_TEXT, canPinAgent } from '#agent/utils/agentAccess';
import { agentCreator, creatorText, ownerMark } from '#agent/utils/agentOwnership';
import {
  DEFAULT_SECTION,
  WORKSPACE_TABS,
  sectionOf,
  settingsSectionOf,
  workspaceTabOf,
  type AgentTab,
  type WorkspaceTab,
} from './sections';

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

// The Ranch admin agent is the Owner's alone (CLEAN-232): for anybody else the
// API answers "Agent not found" on its management routes. So an Admin gets the
// conversation and one line saying who manages the agent: no Settings, no
// lifecycle controls, and none of the requests behind them.
const { canManage } = useAgentAccess(agent);

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
  toolView,
} = useAgentLifecycle(props.id, agent, refresh);

// Pin / unpin (CLEAN-216): its own composable so the optimistic patch and
// rollback stay out of this already long header.
const {
  pinned,
  toggling: pinToggling,
  error: pinError,
  toggle: togglePin,
} = useAgentPin(props.id, agent);

const { tab: requestedTab, setTab } = useAgentTab();

// What is on screen. A viewer who may not manage the agent has the chat only,
// whatever `?tab=` asks for: a link to Files must not open Files for them.
const tab = computed<AgentTab>(() =>
  canManage.value ? requestedTab.value : 'chat',
);
const workspaceTabs = computed<readonly WorkspaceTab[]>(() =>
  canManage.value ? WORKSPACE_TABS : ['chat'],
);

// Settings reopens on the section the operator left it on, not on the first
// one: Chat → Settings → Files → Chat → Settings lands on Files again. Kept
// per agent — this component is keyed by agent id — and not persisted.
const lastSection = ref<AgentTab>(DEFAULT_SECTION);
watch(
  tab,
  (t) => {
    if (sectionOf(t)) lastSection.value = t;
  },
  { immediate: true },
);

function onSelectWorkspaceTab(next: WorkspaceTab) {
  setTab(next === 'chat' ? 'chat' : lastSection.value);
}

// The Settings hub's cards show counts beside their names, so they are
// fetched when Settings is wanted — on hover of the tab, on opening it, and
// on a deep link that lands straight in a section. Not at page load: Chat is
// what opens, and this navigator is not in the DOM there (CLEAN-233). And
// only for a viewer who may open the sections they count (CLEAN-232).
const { counts, load: loadCounts } = useAgentSectionCounts(
  props.id,
  agent,
  canManage,
);

watch(
  tab,
  (t) => {
    if (settingsSectionOf(t)) void loadCounts();
  },
  { immediate: true },
);

/** Hovering or tabbing to Settings is enough to start its counts, so the
 *  numbers are on screen by the time the operator gets there. */
function onPrefetchWorkspaceTab(next: WorkspaceTab) {
  if (next === 'settings') void loadCounts();
}

// The status badge renders from the DB row (not the SSE pod stream). Re-fetch
// when the operator opens Overview so a stale 'failed' or 'deploying' from
// initial load doesn't outlive the reconciled state.
watch(tab, (t) => {
  // A bare `?tab=settings` shows Overview too, so ask what is on screen
  // rather than what the address says.
  if (settingsSectionOf(t)?.value === 'overview') void refresh();
});

const initials = computed(() =>
  agent.value ? agentInitials(agent.value.name, agent.value.id) : '?',
);

// Whose agent it is (CLEAN-259): the badge on the avatar and the words
// beside the name, both read off the store's record, like the rail's.
const mark = computed(() => (agent.value ? ownerMark(agent.value) : null));
const creator = computed(() => (agent.value ? agentCreator(agent.value) : null));
// On the Ranch admin agent the header already says whose it is to manage;
// who created it is said only when that is the viewer.
const creatorLine = computed(() => {
  if (!creator.value) return null;
  if (agent.value?.isAdmin && creator.value.kind !== 'mine') return null;
  return { kind: creator.value.kind, text: creatorText(creator.value) };
});

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

// What the limit store knows about this agent — kept fresh by the workspace's
// summary poll, and by the load poll while Overview is open.
const limitStore = useAgentLimitStore();
const limitEntry = computed(() => limitStore.byAgent[props.id]);

const lifecycleError = computed(
  () => restartError.value || toggleError.value || pinError.value,
);

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
const deployAgo = useRelativeTime(() => lastDeployStartedAt.value);
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
//
// One confirmation for both ways in (CLEAN-228): this menu and the Delete
// block on Overview, which asks for it through `provideAgentDelete`. It is
// the dialog the Edit page had — a backup first if wanted, the opt-in wipe of
// stored files — not the plain "are you sure" this menu used to open.
const confirmRemoveOpen = ref(false);
provideAgentDelete(() => {
  confirmRemoveOpen.value = true;
});

// The dialog has deleted the agent and the store has dropped the record.
// One tick first, so the sections of the deleted agent unmount — Overview
// would otherwise ask whether to discard edits to something that is gone.
const deleted = ref(false);
async function onDeleted() {
  deleted.value = true;
  await nextTick();
  emit('deleted');
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
    <div
      v-if="pendingRestart && canManage"
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
        data-agent-header
      >
        <!-- A 32 px avatar with a badge on each lower corner: the mark sits
             2 px further out than in the rail, so the initials stay clear. -->
        <span class="relative shrink-0 [--owner-mark-shift:-8px]">
          <span
            class="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
          >
            {{ initials }}
          </span>
          <!-- Bottom-left: the status dot has the other corner. -->
          <AgentOwnerMark :mark="mark" />
          <AgentStatusDot
            class="absolute -bottom-0.5 -right-0.5"
            :status="displayStatus"
            :status-reason="statusReason"
            :deploy-verb="lastDeployStartedAt ? deployVerb : null"
            :deploy-ago="lastDeployStartedAt ? deployAgo : null"
            :deploy-hint-title="deployHintTitle"
            :tools="toolView"
          />
        </span>
        <h1 class="min-w-0 truncate text-base font-semibold">{{ agent.name }}</h1>
        <!-- Who created it, in words (CLEAN-259): the badge on the avatar is
             decoration. "Your agent" is written out. Somebody else's name,
             or that none is recorded, is here for a screen reader only: this
             row has no room for a name of any length (it pushed Stop and the
             menu to a second line), and both are written out on Overview,
             under Advanced, "Created by". -->
        <span
          v-if="creatorLine"
          :class="
            creatorLine.kind === 'mine'
              ? 'shrink-0 text-xs font-medium text-primary'
              : 'sr-only'
          "
          :data-agent-creator="creatorLine.kind"
        >
          {{ creatorLine.text }}
        </span>
        <IconShield
          v-if="agent.isAdmin"
          class="size-4 shrink-0 text-primary"
          title="This agent has the ranch_* admin tools and a service token"
        />
        <IconPin
          v-if="agent.pinned"
          class="size-4 shrink-0 text-primary"
          role="img"
          aria-label="Pinned"
          title="Pinned: kept at the top of your list in both consoles"
          data-pinned
        />
        <span
          v-if="runtimeOffline"
          class="shrink-0 text-xs text-orange-600 dark:text-orange-400"
          title="Pod is up but the runtime hasn't connected to the bridle hub yet"
        >
          runtime offline
        </span>
        <!-- Request limits (CLEAN-224): the same two facts the rail row
             marks, from the same store record, as words and not a colour. -->
        <span
          v-if="limitEntry?.atLimit"
          class="shrink-0 text-xs text-rose-700 dark:text-rose-400"
          title="A request limit is full: visitors are being asked to wait"
          data-header-at-limit
        >
          at limit
        </span>
        <button
          v-if="limitEntry?.needsLimits && canManage"
          type="button"
          class="shrink-0 text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
          title="Public with no request limits — set them in the Request limit block on Overview"
          data-header-needs-limits
          @click="setTab('overview')"
        >
          public without limits
        </button>

        <!-- On a phone the header is two rows, and each row ends at the right
             edge: the name with the tabs across from it, the usage line with
             Stop, pin and the menu across from it (CLEAN-252). From `md` up
             it is the one row it always was. -->
        <AgentWorkspaceTabs
          class="ml-auto md:ml-2"
          :tabs="workspaceTabs"
          :active="workspaceTabOf(tab)"
          @select="onSelectWorkspaceTab"
          @prefetch="onPrefetchWorkspaceTab"
        />

        <div class="hidden flex-1 md:block" />

        <!-- One line of usage; the figures open on click (specs/017, R3).
             Below ~900px it wraps under the tabs (`order-last basis-full`)
             so Stop and the menu never leave the row. -->
        <UsageLine
          v-if="canManage"
          :agent-id="agent.id"
          :llm-credential-id="agent.llmCredentialId"
          class="order-last basis-full md:order-none md:basis-auto md:max-w-72"
          @details="setTab('overview')"
        />

        <!-- The one line a viewer who may not manage this agent reads where
             the controls are for the Owner (CLEAN-232). -->
        <p
          v-if="!canManage"
          class="shrink-0 text-xs text-muted-foreground"
          data-owner-managed
        >
          {{ OWNER_MANAGED_TEXT }}
        </p>

        <!-- The row is drawn for every viewer: the pin in it is the viewer's
             own, so it is offered on an agent they may not manage too
             (CLEAN-231). Stop/Start and the menu stay with `canManage`. -->
        <div class="flex shrink-0 items-center gap-2 max-md:ml-auto">
          <Button
            v-if="canManage"
            variant="outline"
            size="sm"
            data-agent-toggle-running
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
          <!-- Pin / unpin (CLEAN-216): one click, reversible, so it earns a
               place on the row rather than in the menu. Not on the Ranch
               assistant, for the Owner either: it is first in the list as
               it is (`canPinAgent`, CLEAN-269). -->
          <Button
            v-if="canPinAgent(agent)"
            variant="outline"
            size="sm"
            class="size-8 p-0"
            :aria-pressed="pinned"
            :disabled="pinToggling"
            :title="
              pinned
                ? 'Unpin: back to its ordinary place in the list'
                : 'Pin: keep this agent at the top of your list in both consoles'
            "
            data-pin-toggle
            @click="togglePin"
          >
            <span class="sr-only">{{ pinned ? 'Unpin' : 'Pin' }}</span>
            <IconLoader2 v-if="pinToggling" class="size-4 animate-spin" />
            <IconPinnedOff v-else-if="pinned" class="size-4" />
            <IconPin v-else class="size-4" />
          </Button>
          <!-- Everything but Stop/Start lives in the menu (specs/017, R6):
               Restart, Tools, Share as a submenu of rows, and Delete
               last, separated — the one action here you cannot undo. -->
          <DropdownMenu v-if="canManage">
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                class="size-8 p-0"
                data-agent-actions
              >
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
              <ShareMenuSub :agent-id="agent.id" />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="cursor-pointer text-destructive focus:text-destructive"
                @select="confirmRemoveOpen = true"
              >
                <IconTrash class="size-4" />
                Delete agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p v-if="lifecycleError" class="shrink-0 text-xs text-destructive">
        {{ lifecycleError }}
      </p>

      <div class="min-h-0 flex-1">
        <AgentWorkspaceCanvas
          :agent="agent"
          :api-url="apiUrl"
          :tab="tab"
          :counts="counts"
          :overlay="chatOverlay"
          :tool-view="toolView"
          :restarting="isRestarting"
          :toggling="toggling"
          @restart="restart"
          @toggle-running="toggleRunning"
          @set-tab="setTab"
          @agent-updated="(updated) => agentStore.upsert(updated)"
        />
      </div>

      <AgentDeleteDialog
        v-if="canManage"
        v-model:open="confirmRemoveOpen"
        :agent-id="agent.id"
        :agent-name="agent.name"
        @deleted="onDeleted"
      />
    </template>

    <!-- `!deleted`: a delete drops the store record before the navigation
         away lands — that gap is not a "not found". -->
    <div
      v-else-if="!deleted"
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Agent not found.
    </div>
  </div>
</template>
