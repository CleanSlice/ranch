<script setup lang="ts">
import { IconEyeOff, IconX } from '@tabler/icons-vue';
import { formatDay } from '#common/utils/format';
import type { IAgentPeer } from '#peer/stores/peer';

/**
 * One peer as a node of the network tree (CLEAN-74). The connector column on
 * the left draws the trunk; the "+ Connect another agent" node in Tab.vue is
 * always below, so every peer row draws its trunk full-height.
 */
const props = defineProps<{
  peer: IAgentPeer;
  busy?: boolean;
  /** Set when another peer advertises the same thing — see Tab.vue. */
  warning?: string | null;
  /** Delegations to this peer in the loaded feed. */
  taskCount: number;
  /** The feed is currently narrowed to this peer. */
  selected?: boolean;
}>();

defineEmits<{
  refresh: [];
  remove: [];
  select: [];
  /** The operator moved the visitors switch; Tab.vue confirms an opening. */
  visitors: [open: boolean];
}>();

/**
 * A peer that serves this viewer through a connection open to visitors,
 * without their having access to it (CLEAN-236). The API sends its skills
 * and nothing that says which agent has them, so the row has no link, no
 * status, no address and nothing to change.
 */
const masked = computed(() => props.peer.visibility === 'masked');

/** "Connected by Ada on 20 Nov 2026", or that the record does not go back that far. */
const connectedBy = computed(() => {
  if (masked.value) return null;
  const who = props.peer.createdBy;
  if (!who) return 'Connected before this was recorded';
  const name = who.name ?? 'an account that no longer exists';
  return `Connected by ${name} on ${formatDay(props.peer.createdAt)}`;
});

const SKILLS_SHOWN = 4;

/**
 * A snapshot this old has had time to drift from what the peer now
 * advertises; the row nudges a re-read without blocking anything.
 */
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const skills = computed(() => props.peer.card?.skills ?? []);
const shown = computed(() => skills.value.slice(0, SKILLS_SHOWN));
const overflow = computed(() => Math.max(0, skills.value.length - SKILLS_SHOWN));

type StatusMeta = {
  label: string;
  dot: string;
  pulse: boolean;
  badge: string;
  border: string;
};

const stale = computed(
  () =>
    Date.now() - new Date(props.peer.cardReadAt).getTime() > STALE_AFTER_MS,
);

const STALE_META: StatusMeta = {
  label: 'stale card',
  dot: 'bg-amber-500',
  pulse: false,
  badge:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500',
  border: '',
};

const meta = computed<StatusMeta>(() => {
  // No status of the agent behind a masked peer reaches this console.
  if (masked.value) {
    return {
      label: 'outside your access',
      dot: 'bg-muted-foreground/50',
      pulse: false,
      badge: 'border-transparent bg-muted text-muted-foreground',
      border: 'border-dashed',
    };
  }
  // An imported foreign agent has no live pod status here; the origin is the
  // status, and only card staleness can degrade it (CLEAN-95).
  if (props.peer.origin === 'external') {
    if (stale.value) return STALE_META;
    return {
      label: 'external',
      dot: 'bg-sky-500',
      pulse: false,
      badge:
        'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-400',
      border: '',
    };
  }

  const bad = {
    dot: 'bg-destructive',
    badge:
      'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
    border: 'border-destructive/40',
  };
  if (!props.peer.peerExists)
    return { ...bad, label: 'gone', pulse: false };
  if (props.peer.peerStatus !== 'running')
    return {
      ...bad,
      label: props.peer.peerStatus,
      pulse: props.peer.peerStatus === 'failed',
    };
  if (stale.value) return STALE_META;
  return {
    label: 'online',
    dot: 'bg-emerald-500',
    pulse: false,
    badge:
      'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-500',
    border: '',
  };
});

const failReason = computed<string | null>(() => {
  if (masked.value) return null;
  if (props.peer.origin === 'external') return null;
  if (!props.peer.peerExists)
    return (
      'This agent no longer exists on this ranch. Delegations to it fail — ' +
      'remove the peer.'
    );
  if (props.peer.peerStatus !== 'running')
    return (
      'Peer is not running — delegations fail fast ("peer not running") ' +
      'until it is back.'
    );
  return null;
});
</script>

<template>
  <div class="flex items-stretch">
    <div class="relative w-11 flex-none">
      <div class="absolute inset-y-0 left-5 w-0.5 bg-border" />
      <div class="absolute left-5 top-1/2 h-0.5 w-6 bg-border" />
    </div>

    <div
      class="my-1.5 min-w-0 flex-1 rounded-xl border bg-card p-4 shadow-sm"
      :class="meta.border"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="size-2 flex-none rounded-full"
          :class="[meta.dot, meta.pulse && 'animate-pulse']"
        />
        <span
          v-if="masked"
          class="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground"
        >
          <IconEyeOff class="size-3.5" />
          {{ peer.peerName }}
        </span>
        <NuxtLink
          v-else-if="peer.peerAgentId"
          :to="`/agents/${peer.peerAgentId}`"
          class="text-sm font-bold hover:underline"
        >
          {{ peer.peerName }}
        </NuxtLink>
        <span v-else class="text-sm font-bold" :title="peer.cardUrl">
          {{ peer.peerName }}
        </span>
        <Badge variant="outline" :class="meta.badge">{{ meta.label }}</Badge>
        <Badge
          v-if="peer.needsReview"
          variant="outline"
          class="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500"
          title="This connection existed before access to peers was checked. Decide whether it serves visitors; saving the switch either way clears this mark."
        >
          needs review
        </Badge>
        <span class="text-xs text-muted-foreground">
          {{ taskCount }} {{ taskCount === 1 ? 'task' : 'tasks' }}
        </span>

        <div class="ml-auto flex gap-1">
          <Button
            v-if="!masked && peer.canRemove"
            variant="outline"
            size="sm"
            class="h-7 px-2.5 text-xs"
            :disabled="busy"
            title="Re-read agent card"
            @click="$emit('refresh')"
          >
            {{ busy ? 'Reading…' : 'Re-read' }}
          </Button>
          <Button
            :variant="selected ? 'default' : 'outline'"
            size="sm"
            class="h-7 px-2.5 text-xs"
            title="Filter the delegation feed by this peer"
            @click="$emit('select')"
          >
            Feed
          </Button>
          <Button
            v-if="peer.canRemove"
            variant="outline"
            size="icon"
            class="size-7 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            :disabled="busy"
            title="Disconnect peer"
            @click="$emit('remove')"
          >
            <IconX class="size-3.5" />
          </Button>
        </div>
      </div>

      <p v-if="masked" class="mt-1.5 text-sm text-muted-foreground">
        A colleague outside your access, open to visitors. It answers through
        this agent for everybody who talks to it. Whoever manages both agents
        can close it.
      </p>
      <p v-else class="mt-1.5 text-sm text-muted-foreground">
        {{ peer.card?.description }}
      </p>

      <!-- Whom it serves (CLEAN-236). An internal peer serves the people who
           have access to it, unless somebody who manages both agents opened
           it. An external one serves everybody, or the one person who added
           it without managing this agent. -->
      <div
        v-if="!masked"
        class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      >
        <label
          v-if="peer.origin === 'internal'"
          class="inline-flex items-center gap-2"
          :title="
            peer.canSetVisitors
              ? 'Open: it answers through this agent for everybody who talks to it, visitors included, and is shown to them without its name.'
              : 'Only somebody who manages both agents can change this.'
          "
        >
          <Switch
            :model-value="peer.openToVisitors"
            :disabled="busy || !peer.canSetVisitors"
            @update:model-value="(open: boolean) => $emit('visitors', open)"
          />
          <span :class="peer.openToVisitors && 'font-medium text-foreground'">
            {{
              peer.openToVisitors
                ? 'Open to visitors'
                : 'Serves people who have access to it'
            }}
          </span>
        </label>
        <span v-else-if="peer.owner">
          Only for {{ peer.owner.name ?? 'the account that added it' }}
        </span>
        <span v-else>Serves everybody who talks to this agent</span>
        <span>{{ connectedBy }}</span>
      </div>

      <div
        v-if="failReason"
        class="mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
      >
        {{ failReason }}
      </div>

      <!-- Two peers whose cards read alike are not blocked, but the model will
           be choosing between them by chance, and nothing else in the product
           would ever tell an operator that. -->
      <p v-if="warning" class="mt-2 text-sm text-amber-600 dark:text-amber-500">
        {{ warning }}
      </p>

      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <template v-if="shown.length">
          <Badge
            v-for="skill in shown"
            :key="skill.id"
            variant="outline"
            :title="skill.description"
          >
            {{ skill.name }}
          </Badge>
          <Badge v-if="overflow" variant="outline">+{{ overflow }}</Badge>
        </template>
        <!-- Consequence + the way to fix it, not just the fact (CLEAN-95).
             An empty card means delegation only reaches this peer by name. -->
        <span
          v-else
          class="text-xs text-amber-700 dark:text-amber-500"
        >
          <template v-if="masked">No skills advertised.</template>
          <template v-else-if="peer.card?.description">
            No skills advertised — matching leans on its description alone.
          </template>
          <template v-else>
            Advertises nothing — reachable by name only, never by topic.
          </template>
          <template v-if="masked" />
          <template v-else-if="peer.peerAgentId">
            Give it a description or
            <NuxtLink
              :to="`/agents/${peer.peerAgentId}?tab=knowledge`"
              class="font-medium underline"
              >a knowledge base</NuxtLink
            >, then Re-read.
          </template>
          <template v-else>
            Ask its owner to publish a description and skills, then Re-read.
          </template>
        </span>
        <span
          v-if="!masked"
          class="ml-auto whitespace-nowrap text-xs text-muted-foreground"
        >
          card read <DateTimeAgoInline :date="peer.cardReadAt" />
        </span>
      </div>
    </div>
  </div>
</template>
