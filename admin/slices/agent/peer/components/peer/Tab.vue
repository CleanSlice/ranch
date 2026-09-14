<script setup lang="ts">
import { IconPlus } from '@tabler/icons-vue';
import { useAgentStore } from '#agent/stores/agent';
import type { IAgentData } from '#agent/domain';
import { usePeerStore, type IAgentPeer } from '#peer/stores/peer';

/**
 * The Peers tab (CLEAN-74): what this agent advertises, who it can delegate
 * to, and what it has delegated lately.
 *
 * Order is deliberate. The agent's own card comes first because it answers
 * "what do other agents see of me", which is the question an operator has
 * before they can judge anyone else's card.
 */
const props = defineProps<{ agent: IAgentData }>();

const store = usePeerStore();
const agentStore = useAgentStore();

const adding = ref(false);
const busyPeerId = ref<string | null>(null);
const confirmingRemoval = ref<IAgentPeer | null>(null);
const actionError = ref<string | null>(null);

const peers = computed(() => store.peers(props.agent.id));
const ownCard = computed(() => store.card(props.agent.id));
const pendingRestart = computed(() =>
  agentStore.isPendingRestart(props.agent.id),
);

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

async function refresh(peer: IAgentPeer) {
  busyPeerId.value = peer.id;
  actionError.value = null;
  try {
    await store.refresh(props.agent.id, peer.id);
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
    confirmingRemoval.value = null;
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
    <Card>
      <CardHeader>
        <CardTitle>Agent card</CardTitle>
        <CardDescription>
          What other agents read about this one. Built from its name,
          description, template skills and knowledge bases — there is nothing
          to write by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="store.loading && !ownCard" class="space-y-2">
          <Skeleton class="h-4 w-40" />
          <Skeleton class="h-4 w-72" />
          <Skeleton class="h-6 w-56" />
        </div>
        <PeerCardView v-else :card="ownCard" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
        <div class="space-y-1.5">
          <CardTitle>Peers</CardTitle>
          <CardDescription>
            Agents this one can hand a task to. Connecting is one-way: it does
            not let them ask anything of this agent.
          </CardDescription>
        </div>
        <Button v-if="!adding" size="sm" @click="adding = true">
          <IconPlus class="mr-1.5 size-4" />
          Add peer
        </Button>
      </CardHeader>

      <CardContent class="space-y-4">
        <PeerPicker
          v-if="adding"
          :agent-id="agent.id"
          @connected="onConnected"
          @cancel="adding = false"
        />

        <div v-if="store.loading && !peers.length" class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else-if="peers.length">
          <PeerRow
            v-for="peer in peers"
            :key="peer.id"
            :peer="peer"
            :busy="busyPeerId === peer.id"
            :warning="warnings[peer.id] ?? null"
            @refresh="refresh(peer)"
            @remove="confirmingRemoval = peer"
          />
        </div>

        <div
          v-else-if="!adding"
          class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          No peers yet. Connect another agent's card to let this one delegate
          tasks it cannot do itself.
        </div>

        <!-- A pod reads its tool list once, at boot. Without this line an
             operator connects a peer, asks a question, gets nothing, and has
             no way to know why. -->
        <p v-if="pendingRestart" class="text-sm text-amber-600 dark:text-amber-500">
          Restart the agent to apply: it reads the list of peers when it starts.
        </p>

        <p v-if="store.error" class="text-sm text-destructive">
          {{ store.error }}
        </p>
        <p v-if="actionError" class="text-sm text-destructive">
          {{ actionError }}
        </p>
      </CardContent>
    </Card>

    <PeerDelegations :agent-id="agent.id" />

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
