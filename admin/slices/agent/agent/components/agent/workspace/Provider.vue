<script setup lang="ts">
import { IconUsersGroup, IconX } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const router = useRouter();
const route = useRoute();

// One list request for the whole workspace. It lives here — above the keyed
// `Main` — so switching agents does not refetch it or flash the rail.
const { data: agents, pending, refresh: refreshAgents } = useAsyncData(
  'admin-agents',
  () => agentStore.fetchAll(),
  { lazy: true },
);

// Cluster headroom for the top action row. Store actions refetch on their
// own; the interval catches pods actually scheduling and other operators'
// changes. The API caches ~15s, so polling is cheap, and null (K8s
// unreachable) simply hides the badge.
const capacity = computed(() => agentStore.capacity ?? null);

let capacityTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void agentStore.fetchCapacity();
  capacityTimer = setInterval(() => void agentStore.fetchCapacity(), 30_000);
});
onUnmounted(() => {
  if (capacityTimer) clearInterval(capacityTimer);
});

// Selecting an agent is real navigation — `push`, so Back undoes it (FR-004).
// The section in `?tab=` rides along: an operator comparing Environment
// across two agents should not be dropped back into a conversation on every
// switch.
function onSelect(id: string) {
  railOverlayOpen.value = false;
  if (id === props.id) return;
  void router.push({ path: `/agents/${id}`, query: { ...route.query } });
}

// Below the tablet breakpoint the rail is one tap away rather than a column.
// The docked/overlay split itself is CSS; this only tracks the tap.
const railOverlayOpen = ref(false);

// ── Available height ─────────────────────────────────────────────────
// The workspace has to be exactly as tall as what is left below the admin
// chrome: `SidebarProvider` is `min-h-svh`, not a fixed height, so the flex
// chain above never bounds us and `flex-1` alone would grow the page instead
// of fitting it.
//
// The obvious fix — subtracting a hard-coded chrome height — is what this
// used to do, and it silently broke the moment the layout's padding changed
// from `p-6` to `p-3`. So measure instead: our own distance from the top of
// the viewport, minus whatever padding and margin sit below us. Nothing to
// re-tune when someone moves a header or a padding again.
const rootEl = ref<HTMLElement | null>(null);
const availableHeight = ref<string>('');

function measureHeight() {
  const el = rootEl.value;
  if (!el || typeof window === 'undefined') return;
  const top = el.getBoundingClientRect().top;
  const parent = el.parentElement;
  const parentStyle = parent ? window.getComputedStyle(parent) : null;
  const inset = parent?.parentElement
    ? window.getComputedStyle(parent.parentElement)
    : null;
  const below =
    (parentStyle ? parseFloat(parentStyle.paddingBottom) || 0 : 0) +
    (inset ? parseFloat(inset.marginBottom) || 0 : 0);
  // The floor keeps the workspace usable if it ever ends up scrolled far
  // enough down that the arithmetic goes negative.
  availableHeight.value = `${Math.max(360, window.innerHeight - top - below)}px`;
}

// A window resize is not the only thing that moves us: collapsing the admin
// sidebar to icons shrinks the page header from 56px to 48px, which shifts
// our top edge without the window changing size at all. Watching the
// container catches both.
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  void nextTick(measureHeight);
  window.addEventListener('resize', measureHeight);
  const parent = rootEl.value?.parentElement;
  if (parent && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureHeight);
    resizeObserver.observe(parent);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', measureHeight);
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/**
 * The open agent was deleted from its own settings panel. Move to whatever is
 * next in the rail rather than leaving the operator on a dead id; an empty
 * rail falls through to the resolver, which renders the empty state.
 */
async function onDeleted() {
  await refreshAgents();
  const next = (agents.value ?? []).find((a) => a.id !== props.id);
  await router.replace(next ? `/agents/${next.id}` : '/agents');
}
</script>

<template>
  <div
    ref="rootEl"
    class="flex min-h-0 flex-col gap-3"
    :style="availableHeight ? { height: availableHeight } : undefined"
  >
    <div class="flex shrink-0 items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        class="lg:hidden"
        @click="railOverlayOpen = true"
      >
        <IconUsersGroup class="size-4" />
        Agents
      </Button>
      <AgentWorkspaceTopBar :capacity="capacity" class="flex-1" />
    </div>

    <div class="flex min-h-0 flex-1 gap-4">
      <aside
        class="hidden w-68 shrink-0 overflow-hidden rounded-lg border bg-card p-2 lg:block"
      >
        <AgentWorkspaceRail
          :agents="agents"
          :active-id="id"
          :pending="pending"
          @select="onSelect"
        />
      </aside>

      <AgentWorkspaceMain :id="id" :key="id" @deleted="onDeleted" />
    </div>

    <!-- Narrow screens: the same rail, on demand, over the whole screen. -->
    <div
      v-if="railOverlayOpen"
      class="fixed inset-0 z-40 flex flex-col gap-2 bg-background p-3 lg:hidden"
    >
      <div class="flex shrink-0 items-center justify-between">
        <span class="text-sm font-medium">Agents</span>
        <Button
          variant="ghost"
          size="sm"
          class="size-8 p-0"
          @click="railOverlayOpen = false"
        >
          <IconX class="size-4" />
          <span class="sr-only">Close</span>
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <AgentWorkspaceRail
          :agents="agents"
          :active-id="id"
          :pending="pending"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>
