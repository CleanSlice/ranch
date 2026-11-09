<script setup lang="ts">
import { agentStatusMeta, LEGEND_STATUSES } from '#agent/utils/agentStatus';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const authStore = useAuthStore();
const { remember } = useLastAgent();

const canCreate = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

// One list request for the whole workspace, shared with the resolver page by
// its key so landing here does not re-fetch what it already read.
//
// The request gives `pending` and `refresh`; the map and the rail render the
// store's collection (docs/state.md), the same records the open chat reads
// by id.
const { pending, refresh } = await useAsyncData('agents', () =>
  agentStore.fetchAll(),
);
const { agents } = storeToRefs(agentStore);

// The map shows every agent's runtime state, so it has to keep up with
// agents other people start and stop. The app console has no status stream
// of its own (admin's SSE feed is public, but porting the client is a
// separate piece of work — see research R3), so this polls at the same
// cadence the cards screen already polled capacity at. The open agent keeps
// its own 3s poll while it is transitioning.
let listTimer: ReturnType<typeof setInterval> | null = null;
let capacityTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  listTimer = setInterval(() => void refresh(), 30_000);
  if (!canCreate.value) return;
  void agentStore.fetchCapacity();
  capacityTimer = setInterval(() => void agentStore.fetchCapacity(), 30_000);
});
onUnmounted(() => {
  if (listTimer) clearInterval(listTimer);
  if (capacityTimer) clearInterval(capacityTimer);
});

const capacity = computed(() => agentStore.capacity);

// The open agent, for the sheet: the same store record the chat below
// fetches by id and the map node reads, so a restart flips all three
// together.
const agent = computed(() => agentStore.byId(props.id));

// Remember whichever agent is open so the next visit lands back on it.
watch(
  () => props.id,
  (id) => {
    if (id) remember(id);
  },
  { immediate: true },
);

/* ── Map or list ───────────────────────────────────────────────────────── */

type View = 'orbit' | 'drum' | 'list';
const VIEWS: View[] = ['orbit', 'drum', 'list'];
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

const matches = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = agents.value ?? [];
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
    <!-- Desktop, orbit or drum: the map owns the width; the cockpit is a
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
          v-if="view === 'orbit'"
          :agents="agents"
          :active-id="id"
          :pending="pending"
          :search="search"
          @select="onSelect"
        />
        <AgentWorkspaceDrum
          v-else
          :agents="agents"
          :active-id="id"
          :pending="pending"
          :search="search"
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
          @select="onSelect"
        />
      </div>
    </aside>

    <!-- The cockpit: sheet above, chat below. A column beside the map, the
         whole width beside the rail and on a phone. -->
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      :class="view !== 'list' && 'lg:w-[460px] lg:flex-none lg:border-l xl:w-[520px]'"
    >
      <!-- Narrow screens: the list is one tap away rather than a column. -->
      <div class="shrink-0 border-b px-3 py-2 lg:hidden">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          @click="railOverlayOpen = true"
        >
          <Icon name="list" :size="13" />
          {{ $t('rail.switch') }}
        </button>
      </div>

      <AgentWorkspaceSheet
        :agent="agent"
        :pending="pending"
        :can-manage="canCreate"
      />

      <div class="min-h-0 flex-1">
        <AgentChatProvider :id="id" compact />
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
