<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { IconCheck, IconSearch } from '@tabler/icons-vue';
import { toast } from 'vue-sonner';
import { AGENT_STATUS_VARIANT } from '#agent/utils/agentFormat';
import type { AgentStatusTypes } from '#agent/domain';
import {
  usePeerStore,
  type IAgentCard,
  type IAgentPeerCandidate,
} from '#peer/stores/peer';

/**
 * Pick an agent, read its card, then connect (CLEAN-74).
 *
 * The preview step is the point of this component. Connecting a peer decides
 * what another agent will be told it can ask for, so the operator sees the
 * exact text first — a name alone would make "why did it pick the wrong one"
 * unanswerable later.
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
    void store.loadCandidates(props.agentId);
  },
);

async function select(candidate: IAgentPeerCandidate) {
  if (candidate.connected) return;
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
          Agents on this ranch this one isn't connected to yet. Connecting is
          one-way.
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
                @click="select(candidate)"
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
              </button>
            </li>
          </ul>

          <p v-else-if="filter" class="text-sm text-muted-foreground">
            No agent matches "{{ filter }}".
          </p>
          <p v-else class="border-t pt-3.5 text-sm text-muted-foreground">
            No unconnected agents left on this ranch.
          </p>

          <div v-if="selected" class="space-y-3 rounded-xl border bg-muted/40 p-3">
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
                {{ connecting ? 'Connecting…' : `Connect «${selected.name}»` }}
              </Button>
            </template>
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
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
