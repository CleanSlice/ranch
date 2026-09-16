<script setup lang="ts">
import { IconPlus } from '@tabler/icons-vue';
import { toast } from 'vue-sonner';
import { useAgentStore } from '#agent/stores/agent';
import type { IAgentData } from '#agent/domain';
import { usePeerStore, type IAgentPeer } from '#peer/stores/peer';

/**
 * The Peers tab (CLEAN-74): what this agent advertises, who it can delegate
 * to, and what it has delegated lately.
 *
 * Layout follows the "A2A Peers" design: a card summary header (address,
 * advertise warning), then the peer network as a tree next to a live
 * delegation feed. The tree and the feed talk to each other — a peer's
 * "Feed" button narrows the feed to that peer.
 */
const props = defineProps<{ agent: IAgentData }>();

const store = usePeerStore();
const agentStore = useAgentStore();

const adding = ref(false);
const busyPeerId = ref<string | null>(null);
const confirmingRemoval = ref<IAgentPeer | null>(null);
const actionError = ref<string | null>(null);
const copied = ref(false);
/** Set by a peer row's "Feed" button; narrows the delegation feed. */
const peerFilter = ref<{ id: string; name: string } | null>(null);

const peers = computed(() => store.peers(props.agent.id));
const ownCard = computed(() => store.card(props.agent.id));
const delegations = computed(() => store.delegations(props.agent.id));
const pendingRestart = computed(() =>
  agentStore.isPendingRestart(props.agent.id),
);

const address = computed(
  () => ownCard.value?.supportedInterfaces?.[0]?.url ?? null,
);
const nothingAdvertised = computed(
  () => Boolean(ownCard.value) && !ownCard.value!.skills.length,
);
const needAttention = computed(
  () =>
    peers.value.filter((p) => !p.peerExists || p.peerStatus !== 'running')
      .length,
);

function taskCount(peer: IAgentPeer): number {
  return delegations.value.filter((d) => d.peerAgentId === peer.peerAgentId)
    .length;
}

/**
 * Two peers whose descriptions read alike leave the model choosing by chance.
 * The platform does not block it — sometimes it is temporary — but nothing
 * else in the product would ever surface it.
 */
const warnings = computed<Record<string, string>>(() => {
  const byDescription = new Map<string, IAgentPeer[]>();
  for (const peer of peers.value) {
    const key = (peer.card?.description ?? '').trim().toLowerCase();
    if (!key) continue;
    byDescription.set(key, [...(byDescription.get(key) ?? []), peer]);
  }

  const result: Record<string, string> = {};
  for (const group of byDescription.values()) {
    if (group.length < 2) continue;
    for (const peer of group) {
      const others = group
        .filter((p) => p.id !== peer.id)
        .map((p) => `«${p.peerName}»`)
        .join(', ');
      result[peer.id] =
        `Reads the same as ${others}. This agent will be choosing between ` +
        'them by chance — give each a description that says what only it can do.';
    }
  }
  return result;
});

onMounted(() => {
  void store.load(props.agent.id);
  void store.loadDelegations(props.agent.id);
});

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(copiedTimer));

async function copyAddress() {
  if (!address.value) return;
  try {
    await navigator.clipboard.writeText(address.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    toast.error('Could not copy the address');
  }
}

function toggleFilter(peer: IAgentPeer) {
  peerFilter.value =
    peerFilter.value?.id === peer.peerAgentId
      ? null
      : { id: peer.peerAgentId, name: peer.peerName };
}

async function refresh(peer: IAgentPeer) {
  busyPeerId.value = peer.id;
  actionError.value = null;
  try {
    await store.refresh(props.agent.id, peer.id);
    toast.success(`«${peer.peerName}» card re-read — up to date`);
  } catch (err) {
    actionError.value =
      err instanceof Error ? err.message : 'Could not refresh that card';
  } finally {
    busyPeerId.value = null;
  }
}

async function confirmRemoval() {
  const peer = confirmingRemoval.value;
  if (!peer) return;
  busyPeerId.value = peer.id;
  actionError.value = null;
  try {
    await store.remove(props.agent.id, peer.id);
    if (peerFilter.value?.id === peer.peerAgentId) peerFilter.value = null;
    confirmingRemoval.value = null;
    toast.success(`«${peer.peerName}» disconnected`);
  } catch (err) {
    actionError.value =
      err instanceof Error ? err.message : 'Could not remove that peer';
  } finally {
    busyPeerId.value = null;
  }
}

function onConnected() {
  adding.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- ═══ Card summary header ═══ -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-64 flex-1 space-y-3">
        <div>
          <h2 class="text-lg font-semibold tracking-tight">Agent card</h2>
          <p class="text-sm text-muted-foreground">
            What other agents read about this one — built from its name,
            description, template skills and knowledge bases. Nothing to write
            by hand.
          </p>
        </div>

        <div v-if="store.loading && !ownCard" class="space-y-2">
          <Skeleton class="h-4 w-72" />
          <Skeleton class="h-6 w-56" />
        </div>
        <template v-else-if="ownCard">
          <!-- The exact description a delegating model reads from the card —
               shown verbatim, not paraphrased, for the same reason CardView
               never prettified it. -->
          <p v-if="ownCard.description" class="text-sm">
            {{ ownCard.description }}
          </p>
          <div
            v-if="nothingAdvertised"
            class="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span class="size-1.5 flex-none rounded-full bg-destructive" />
            Card advertises nothing — give it skills or a knowledge base so
            peers know when to ask
          </div>
          <ul v-else class="flex flex-wrap gap-1.5">
            <li v-for="skill in ownCard.skills" :key="skill.id">
              <Badge variant="outline" :title="skill.description">
                {{ skill.name }}
              </Badge>
            </li>
          </ul>
        </template>
      </div>

      <div class="flex flex-col items-end gap-2">
        <div
          v-if="address"
          class="flex items-center gap-1.5 rounded-lg border bg-card py-1 pl-3 pr-1"
        >
          <span
            class="max-w-80 truncate font-mono text-xs text-muted-foreground"
            :title="address"
          >
            {{ address }}
          </span>
          <Button size="sm" class="h-7" @click="copyAddress">
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          {{ peers.length }} {{ peers.length === 1 ? 'peer' : 'peers'
          }}<template v-if="needAttention">
            · {{ needAttention }} need attention</template
          >
        </p>
      </div>
    </div>

    <!-- A pod reads its tool list once, at boot. Without this line an
         operator connects a peer, asks a question, gets nothing, and has
         no way to know why. -->
    <p
      v-if="pendingRestart"
      class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-500"
    >
      Restart the agent to apply: it reads the list of peers when it starts.
    </p>

    <Separator />

    <div class="grid items-start gap-8 xl:grid-cols-2">
      <!-- ═══ Peer network ═══ -->
      <section>
        <div class="mb-3.5 flex items-baseline justify-between gap-3">
          <div>
            <h3 class="font-semibold tracking-tight">Peer network</h3>
            <p class="mt-0.5 text-xs text-muted-foreground">
              One-way: {{ agent.name }} delegates → peers. They can't ask back.
            </p>
          </div>
          <Button size="sm" class="flex-none rounded-full" @click="adding = true">
            <IconPlus class="mr-1.5 size-4" />
            Add peer
          </Button>
        </div>

        <!-- hub node -->
        <div
          class="flex w-fit items-center gap-2.5 rounded-xl bg-foreground px-4 py-2.5 text-background"
        >
          <span
            class="size-2 flex-none rounded-full"
            :class="agent.status === 'running' ? 'bg-emerald-500' : 'bg-amber-500'"
          />
          <span class="text-sm font-bold">{{ agent.name }}</span>
          <span class="text-[11px] opacity-60">
            delegates to {{ peers.length }}
            {{ peers.length === 1 ? 'peer' : 'peers' }}
          </span>
        </div>

        <!-- tree -->
        <div v-if="store.loading && !peers.length" class="mt-3 space-y-3 pl-11">
          <Skeleton class="h-20 w-full" />
          <Skeleton class="h-20 w-full" />
        </div>
        <div v-else class="flex flex-col">
          <PeerRow
            v-for="peer in peers"
            :key="peer.id"
            :peer="peer"
            :busy="busyPeerId === peer.id"
            :warning="warnings[peer.id] ?? null"
            :task-count="taskCount(peer)"
            :selected="peerFilter?.id === peer.peerAgentId"
            @refresh="refresh(peer)"
            @remove="confirmingRemoval = peer"
            @select="toggleFilter(peer)"
          />

          <!-- add node -->
          <div class="flex items-stretch">
            <div class="relative w-11 flex-none">
              <div class="absolute left-5 top-0 h-1/2 w-0.5 bg-border" />
              <div class="absolute left-5 top-1/2 h-0.5 w-6 bg-border" />
            </div>
            <button
              type="button"
              class="my-1.5 flex-1 rounded-xl border-2 border-dashed p-4 text-left text-sm font-medium text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
              @click="adding = true"
            >
              + Connect another agent
            </button>
          </div>
        </div>

        <p v-if="store.error" class="mt-2 text-sm text-destructive">
          {{ store.error }}
        </p>
        <p v-if="actionError" class="mt-2 text-sm text-destructive">
          {{ actionError }}
        </p>
      </section>

      <!-- ═══ Delegation feed ═══ -->
      <PeerDelegations
        v-model:peer-filter="peerFilter"
        :agent-id="agent.id"
      />
    </div>

    <PeerPicker
      v-model:open="adding"
      :agent-id="agent.id"
      @connected="onConnected"
    />

    <ConfirmDialog
      :open="Boolean(confirmingRemoval)"
      :title="`Remove «${confirmingRemoval?.peerName}»?`"
      description="This agent will no longer be able to delegate to it, and the credential issued for the pair stops working. You can connect it again later."
      confirm-label="Remove peer"
      :busy="Boolean(busyPeerId)"
      @update:open="(open: boolean) => !open && (confirmingRemoval = null)"
      @confirm="confirmRemoval"
    />
  </div>
</template>
