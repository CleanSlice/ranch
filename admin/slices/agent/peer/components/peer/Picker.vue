<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { IconCheck, IconChevronDown, IconSearch } from '@tabler/icons-vue';
import { toast } from 'vue-sonner';
import { AGENT_STATUS_VARIANT } from '#agent/utils/agentFormat';
import type { AgentStatusTypes } from '#agent/domain';
import {
  usePeerStore,
  type IAgentCard,
  type IAgentPeerCandidate,
} from '#peer/stores/peer';

/* IAgentCard is also the shape previewByUrl returns — one preview, two
 * sources (CLEAN-95). */

/**
 * Pick an agent, read its card, then connect (CLEAN-74, CLEAN-94).
 *
 * The preview step is the point of this component. Connecting a peer decides
 * what another agent will be told it can ask for, so the operator sees the
 * exact text first — a name alone would make "why did it pick the wrong one"
 * unanswerable later.
 *
 * The preview expands under the clicked row, accordion-style: at ten
 * candidates a panel below the list sits under the fold, and a click that
 * renders off-screen reads as a click that did nothing (CLEAN-94).
 */
const props = defineProps<{ open: boolean; agentId: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; connected: [] }>();

const store = usePeerStore();

const filter = ref('');
const selected = ref<IAgentPeerCandidate | null>(null);
const preview = ref<IAgentCard | null>(null);
const previewing = ref(false);
const connecting = ref(false);
const error = ref<string | null>(null);

const FILTER_FROM = 6;

const candidates = computed(() => store.candidates(props.agentId));

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return candidates.value;
  return candidates.value.filter((c) => c.name.toLowerCase().includes(q));
});

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    filter.value = '';
    selected.value = null;
    preview.value = null;
    error.value = null;
    url.value = '';
    urlToken.value = '';
    urlPreview.value = null;
    urlError.value = null;
    void store.loadCandidates(props.agentId);
  },
);

async function toggle(candidate: IAgentPeerCandidate) {
  if (candidate.connected || connecting.value) return;
  if (selected.value?.id === candidate.id) {
    selected.value = null;
    preview.value = null;
    error.value = null;
    return;
  }
  selected.value = candidate;
  preview.value = null;
  error.value = null;
  previewing.value = true;
  try {
    preview.value = await store.previewCard(candidate.id);
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Could not read that agent card';
  } finally {
    previewing.value = false;
  }
}

async function connect() {
  if (!selected.value) return;
  connecting.value = true;
  error.value = null;
  try {
    await store.connect(props.agentId, selected.value.id);
    toast.success(`«${selected.value.name}» connected — card read`);
    emit('connected');
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Could not connect that peer';
  } finally {
    connecting.value = false;
  }
}

// ── Import an external agent by address (CLEAN-95) ──────────────
const url = ref('');
const urlToken = ref('');
const urlPreview = ref<IAgentCard | null>(null);
const urlPreviewing = ref(false);
const urlImporting = ref(false);
const urlError = ref<string | null>(null);

// A changed address invalidates the card already shown for the old one.
watch(url, () => {
  urlPreview.value = null;
  urlError.value = null;
});

async function previewUrl() {
  if (!url.value.trim()) return;
  urlPreviewing.value = true;
  urlError.value = null;
  urlPreview.value = null;
  try {
    urlPreview.value = await store.previewByUrl(
      props.agentId,
      url.value.trim(),
      urlToken.value.trim() || undefined,
    );
  } catch (err) {
    urlError.value =
      err instanceof Error ? err.message : 'Could not read that address';
  } finally {
    urlPreviewing.value = false;
  }
}

async function importUrl() {
  if (!urlPreview.value) return;
  urlImporting.value = true;
  urlError.value = null;
  try {
    const imported = await store.importByUrl(
      props.agentId,
      url.value.trim(),
      urlToken.value.trim() || undefined,
    );
    toast.success(`«${imported.peerName}» connected — card read`);
    emit('connected');
  } catch (err) {
    urlError.value =
      err instanceof Error ? err.message : 'Could not import that agent';
  } finally {
    urlImporting.value = false;
  }
}

function statusVariant(status: string) {
  return AGENT_STATUS_VARIANT[status as AgentStatusTypes] ?? 'outline';
}
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-6 shadow-lg duration-200"
      >
        <DialogTitle class="text-lg font-bold tracking-tight">
          Add peer
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          Agents on this ranch this one isn't connected to yet. Click an agent
          to read its card, then connect.
        </DialogDescription>

        <div class="mt-3.5 flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
          <div v-if="candidates.length >= FILTER_FROM" class="relative">
            <IconSearch
              class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input v-model="filter" placeholder="Filter agents" class="pl-8" />
          </div>

          <ul v-if="visible.length" class="flex flex-col">
            <li
              v-for="candidate in visible"
              :key="candidate.id"
              class="border-t first:border-t-0"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-1 py-3 text-left text-sm transition-colors"
                :class="[
                  candidate.connected
                    ? 'cursor-default text-muted-foreground'
                    : 'hover:bg-muted/60',
                  selected?.id === candidate.id ? 'bg-muted/60' : '',
                ]"
                :disabled="candidate.connected"
                @click="toggle(candidate)"
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-semibold">
                    {{ candidate.name }}
                  </span>
                  <Badge :variant="statusVariant(candidate.status)">
                    {{ candidate.status }}
                  </Badge>
                </span>
                <span
                  v-if="candidate.connected"
                  class="flex shrink-0 items-center gap-1 text-xs"
                >
                  <IconCheck class="size-3.5" />
                  connected
                </span>
                <!-- The affordance the row was missing: says what a click
                     does, and doubles as the open/closed indicator. -->
                <span
                  v-else
                  class="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  Info
                  <IconChevronDown
                    class="size-3.5 transition-transform"
                    :class="selected?.id === candidate.id && 'rotate-180'"
                  />
                </span>
              </button>

              <!-- Accordion body: the card opens right where the click
                   happened, not below the whole list. -->
              <div
                v-if="selected?.id === candidate.id"
                class="mb-3 space-y-3 rounded-xl border bg-muted/40 p-3"
              >
                <div v-if="previewing" class="space-y-2">
                  <Skeleton class="h-4 w-40" />
                  <Skeleton class="h-4 w-64" />
                  <Skeleton class="h-6 w-52" />
                </div>
                <template v-else>
                  <PeerCardView :card="preview" compact />
                  <Button
                    size="sm"
                    class="rounded-full"
                    :disabled="connecting || !preview"
                    @click="connect"
                  >
                    {{
                      connecting ? 'Connecting…' : `Connect «${candidate.name}»`
                    }}
                  </Button>
                </template>
                <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
              </div>
            </li>
          </ul>

          <p v-else-if="filter" class="text-sm text-muted-foreground">
            No agent matches "{{ filter }}".
          </p>
          <p v-else class="border-t pt-3.5 text-sm text-muted-foreground">
            No unconnected agents left on this ranch.
          </p>

          <!-- ═══ Import by URL (CLEAN-95) ═══ -->
          <div class="border-t pt-3.5">
            <p class="text-sm font-semibold">Import an external agent</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Any A2A 1.0 agent outside this ranch, by its address. Importing
              the same address again updates the entry — no duplicates.
            </p>
            <div class="mt-2.5 space-y-2">
              <Input
                v-model="url"
                placeholder="https://other.ranch/a2a/agents/agent-…"
                class="font-mono text-xs"
              />
              <Input
                v-model="urlToken"
                type="password"
                placeholder="Access credential (optional)"
                class="text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                class="rounded-full"
                :disabled="urlPreviewing || !url.trim()"
                @click="previewUrl"
              >
                {{ urlPreviewing ? 'Reading…' : 'Read card' }}
              </Button>
            </div>

            <div
              v-if="urlPreview"
              class="mt-2.5 space-y-3 rounded-xl border bg-muted/40 p-3"
            >
              <PeerCardView :card="urlPreview" compact />
              <Button
                size="sm"
                class="rounded-full"
                :disabled="urlImporting"
                @click="importUrl"
              >
                {{
                  urlImporting
                    ? 'Connecting…'
                    : `Connect «${urlPreview.name}»`
                }}
              </Button>
            </div>

            <p v-if="urlError" class="mt-2 text-sm text-destructive">
              {{ urlError }}
            </p>
          </div>
        </div>

        <div class="mt-3.5 flex justify-end">
          <Button
            variant="outline"
            class="rounded-full"
            @click="emit('update:open', false)"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
