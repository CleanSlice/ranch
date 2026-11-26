<script setup lang="ts">
import { canManageAgent } from '#agent/utils/agentAccess';
import { agentStatusMeta, LEGEND_STATUSES } from '#agent/utils/agentStatus';
import {
  effectiveOwnerFilter,
  filterByOwner,
  ownAgents,
  type OwnerFilterTypes,
} from '#agent/utils/agentOwnership';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const authStore = useAuthStore();
const { remember } = useLastAgent();

const canCreate = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

// The list, its 30 s refresh and (for operators) cluster capacity and the
// agent-to-agent connections come from
// one composable the profile page shares (CLEAN-217): same request key, same
// cadence, same role gate as before the move. The request gives `pending`;
// the map and the rail render the store's collection (docs/state.md), the
// same records the open chat reads by id.
//
// Not awaited (CLEAN-260): a cold load by address waited for the list with
// nothing of the page on screen, and then again for the agent. The rail and
// the map have their own placeholders for `pending`, the sheet says
// "Loading…", and the chat shows the conversation the browser keeps, or its
// placeholders, with the composer in place.
const fleet = useAgentFleet();
const { pending, agents, capacity, links } = fleet;

// The open agent, for the sheet: the same store record the chat below
// fetches by id and the map node reads, so a restart flips all three
// together.
const agent = computed(() => agentStore.byId(props.id));

// The sheet's restart, stop and start. Not the role alone: the Ranch admin
// agent is the Owner's, and the API answers an Admin "Agent not found" on its
// management routes (CLEAN-232). The pin is not gated: it is the viewer's own
// (CLEAN-231).
const canManageOpen = computed(() =>
  agent.value ? canManageAgent(authStore.role, agent.value) : false,
);

// The hub said this account does not reach the open agent (CLEAN-231): the
// record leaves the list and the page leaves for the agents.
useAgentGone(() => props.id);

/* ── Chat or history ───────────────────────────────────────────────────── */

// What stands under the sheet: the chat, this agent's conversations, or one
// closed conversation (CLEAN-248). It is read from the address, so another
// agent, whose address carries no query, opens in the chat.
const {
  view: panelView,
  toChat,
  toList,
  toConversation,
  back: panelBack,
} = useAgentPanelView(() => props.id);

const chatStore = useChatStore();
const bridleStore = useBridleStore();

// The first page of the agent's history is asked for when the agent opens:
// the History counter needs the total, and the same answer makes the list
// appear without a wait. A failure shows nothing here; choosing History asks
// again and says so.
watch(
  () => props.id,
  (id) => {
    if (id) void chatStore.loadHistory(id);
  },
  { immediate: true },
);

// A new chat closes the conversation into history. The archive call moves
// the index row before it answers, so a reload when the button stops being
// busy is enough: the counter and the list follow without Sync. A refusal
// passes through here too, and then the reload changes nothing.
watch(
  () => bridleStore.newChatBlock(props.id),
  (now, before) => {
    if (before === 'busy' && now !== 'busy') void chatStore.refreshHistory(props.id);
  },
);

// Remember whichever agent is open so the next visit lands back on it.
watch(
  () => props.id,
  (id) => {
    if (id) remember(id);
  },
  { immediate: true },
);

/* ── Map or list ───────────────────────────────────────────────────────── */

// Two views: the orbit map and the plain list. A third, the drum, was
// removed after review; a browser that still remembers it gets the map.
type View = 'orbit' | 'list';
const VIEWS: View[] = ['orbit', 'list'];
const VIEW_KEY = 'agent:view';
const view = ref<View>('orbit');
onMounted(() => {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY) as View | null;
    if (saved && VIEWS.includes(saved)) view.value = saved;
  } catch {
    // Private mode — the map it is.
  }
});
function setView(next: View) {
  view.value = next;
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Losing the memory costs one click next time.
  }
}

// Transient by design: a filter that survived a reload would leave someone
// staring at a map with every node dimmed and no memory of why.
const search = ref('');
const searchEl = ref<HTMLInputElement | null>(null);

// "All" or "Mine" (CLEAN-259). View state, transient like the search and
// for the same reason; which agents are "mine" is read off the store's
// records. One value for the map and for both lists, so switching between
// them does not change what is shown.
const ownerFilter = ref<OwnerFilterTypes>('all');
const ownCount = computed(() => ownAgents(agents.value ?? []).length);
const shownOwnerFilter = computed(() =>
  effectiveOwnerFilter(ownerFilter.value, ownCount.value),
);

const matches = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = filterByOwner(agents.value ?? [], shownOwnerFilter.value);
  return term ? list.filter((a) => a.name.toLowerCase().includes(term)) : list;
});

// Enter in the map's search opens the first match; Escape clears it.
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    const first = matches.value[0];
    if (first) onSelect(first.id);
  } else if (event.key === 'Escape') {
    search.value = '';
    searchEl.value?.blur();
  }
}

// ⌘K / Ctrl+K reaches whichever search is on screen: the map's own, or the
// rail's (which marks its input for this).
function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const input =
      searchEl.value ??
      document.querySelector<HTMLInputElement>('[data-agent-search]');
    input?.focus();
    input?.select();
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));

const legend = computed(() => {
  const list = agents.value ?? [];
  return LEGEND_STATUSES.map((status) => ({
    status,
    count: list.filter((a) => a.status === status).length,
    meta: agentStatusMeta(status),
  })).filter((entry) => entry.count > 0);
});

const railOverlayOpen = ref(false);

function onSelect(id: string) {
  railOverlayOpen.value = false;
  if (id === props.id) return;
  void navigateTo(`/agents/${id}`);
}
</script>

<template>
  <!-- 3.5rem + 1px = the app header and its border. The layout already treats
       this route as flush (no container, no footer), so the workspace owns
       the remaining height. -->
  <div class="agent-workspace flex h-[calc(100vh-3.5rem-1px)] min-h-0">
    <!-- Desktop, orbit: the map owns the width; the cockpit is a
         column on the right. -->
    <section
      v-if="view !== 'list'"
      class="agent-workspace__map relative hidden min-w-0 flex-1 flex-col lg:flex"
    >
      <div class="relative z-10 flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
        <div
          class="inline-flex gap-0.5 rounded-full border bg-card p-0.5 text-xs"
          role="tablist"
          :aria-label="$t('orbit.view_label')"
        >
          <button
            v-for="option in VIEWS"
            :key="option"
            type="button"
            role="tab"
            class="rounded-full px-3 py-1.5 transition"
            :class="option === view ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :aria-selected="option === view"
            @click="setView(option)"
          >
            {{ $t(`orbit.view_${option}`) }}
          </button>
        </div>

        <div class="relative w-60 max-w-full">
          <Icon
            name="search"
            :size="14"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref="searchEl"
            v-model="search"
            type="search"
            :placeholder="$t('rail.search')"
            :aria-label="$t('rail.search')"
            data-agent-search
            class="w-full rounded-full border bg-card py-2 pl-8 pr-12 text-sm transition-colors placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25"
            @keydown="onSearchKeydown"
          />
          <kbd
            class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
        </div>

        <!-- On the map nothing is taken away: the agents that are not the
             viewer's are dimmed, the way a search dims what it does not
             match, so every node keeps its place. -->
        <AgentOwnerFilter
          v-if="ownCount > 0"
          v-model="ownerFilter"
          :total="agents?.length ?? 0"
          :mine="ownCount"
        />
      </div>

      <div class="relative z-10 shrink-0 px-4 pt-2">
        <ul v-if="legend.length" class="flex flex-wrap items-center gap-4">
          <li
            v-for="entry in legend"
            :key="entry.status"
            class="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"
          >
            <span
              class="h-[7px] w-[7px] rounded-full"
              :style="{ background: entry.meta.color }"
              aria-hidden="true"
            />
            {{ entry.meta.labelKey ? $t(entry.meta.labelKey) : entry.status }}
            <b class="font-medium text-foreground">{{ entry.count }}</b>
          </li>
        </ul>
      </div>

      <div class="min-h-0 flex-1">
        <AgentWorkspaceOrbit
          :agents="agents"
          :links="links"
          :active-id="id"
          :pending="pending"
          :search="search"
          :mine-only="shownOwnerFilter === 'mine'"
          @select="onSelect"
        />
      </div>

      <div
        v-if="canCreate"
        class="relative z-10 flex shrink-0 items-center gap-3 px-4 pb-3"
      >
        <p
          v-if="capacity"
          class="text-xs"
          :class="
            capacity.freeAgentSlots === 0
              ? 'font-medium text-amber-600 dark:text-amber-400'
              : 'font-mono text-[11px] text-muted-foreground'
          "
        >
          {{
            $t(
              'list.slots_free',
              { count: capacity.freeAgentSlots },
              capacity.freeAgentSlots,
            )
          }}
        </p>
        <NuxtLink
          to="/agents/create"
          class="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-95"
        >
          <Icon name="plus" :size="13" />
          {{ $t('list.create') }}
        </NuxtLink>
      </div>
    </section>

    <!-- Desktop, list view: the rail as before, the cockpit takes the rest. -->
    <aside
      v-else
      class="hidden w-68 shrink-0 flex-col gap-2 border-r bg-card/40 p-3 lg:flex"
    >
      <div
        class="inline-flex shrink-0 gap-0.5 self-start rounded-full border bg-card p-0.5 text-xs"
        role="tablist"
        :aria-label="$t('orbit.view_label')"
      >
        <button
          v-for="option in VIEWS"
          :key="option"
          type="button"
          role="tab"
          class="rounded-full px-3 py-1.5 transition"
          :class="option === view ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-selected="option === view"
          @click="setView(option)"
        >
          {{ $t(`orbit.view_${option}`) }}
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <AgentWorkspaceRail
          :agents="agents"
          :active-id="id"
          :pending="pending"
          :can-create="canCreate"
          :capacity="capacity"
          v-model:owner-filter="ownerFilter"
          @select="onSelect"
        />
      </div>
    </aside>

    <!-- The cockpit: sheet above, chat below. A column beside the map, the
         whole width beside the rail and on a phone. -->
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      :class="view !== 'list' && 'lg:w-[500px] lg:flex-none lg:border-l xl:w-[600px] 2xl:w-[720px]'"
    >
      <!-- Narrow screens: the list is one tap away rather than a column. -->
      <div class="shrink-0 border-b px-3 py-2 lg:hidden">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          data-rail-open
          @click="railOverlayOpen = true"
        >
          <Icon name="list" :size="13" />
          {{ $t('rail.switch') }}
        </button>
      </div>

      <!-- Keyed by agent: the workspace itself stays mounted across
           `/agents/:id` (see the page), and these two hold state that is one
           agent's own: a failed action, a restart in flight, the request
           for its record. -->
      <AgentWorkspaceSheet
        :key="id"
        :agent="agent"
        :pending="pending"
        :can-manage="canManageOpen"
        :view="panelView.kind"
        @to-chat="toChat"
        @to-list="toList"
      />

      <div class="min-h-0 flex-1" data-agent-pane>
        <!-- The chat stays mounted under the history, hidden: its socket, the
             text typed but not sent, the queue and the scroll position are
             all there when the person comes back, and an answer that was on
             its way finishes meanwhile (CLEAN-248). -->
        <AgentChatProvider
          v-show="panelView.kind === 'chat'"
          :id="id"
          :key="id"
          compact
        />
        <ChatHistoryProvider
          v-if="panelView.kind !== 'chat'"
          :key="`history:${id}`"
          :agent-id="id"
          :chat-id="panelView.kind === 'conversation' ? panelView.chatId : null"
          @open="toConversation"
          @to-chat="toChat"
          @back="panelBack"
        />
      </div>
    </div>

    <div
      v-if="railOverlayOpen"
      class="fixed inset-0 z-40 flex flex-col gap-2 bg-background p-3 lg:hidden"
    >
      <div class="flex shrink-0 items-center justify-between">
        <span class="text-sm font-medium">{{ $t('nav.agents') }}</span>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          :aria-label="$t('rail.close')"
          @click="railOverlayOpen = false"
        >
          <Icon name="x" :size="16" />
        </button>
      </div>

      <div class="min-h-0 flex-1">
        <AgentWorkspaceRail
          :agents="agents"
          :active-id="id"
          :pending="pending"
          :can-create="canCreate"
          :capacity="capacity"
          v-model:owner-filter="ownerFilter"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-workspace__map {
  background:
    radial-gradient(50% 50% at 50% 50%, rgba(201, 161, 228, 0.07), transparent 70%),
    /* Ellipse kept inside the pane (62% + 40% · 70% = 90%), so the copper
       floor fades out above the footer row instead of being cut by it. */
    radial-gradient(60% 40% at 50% 62%, rgba(245, 161, 107, 0.1), transparent 70%);
}
</style>
