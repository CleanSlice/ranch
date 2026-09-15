<script setup lang="ts">
import { IconX } from '@tabler/icons-vue';
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

defineEmits<{ refresh: []; remove: []; select: [] }>();

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

const meta = computed<StatusMeta>(() => {
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
  const age = Date.now() - new Date(props.peer.cardReadAt).getTime();
  if (age > STALE_AFTER_MS)
    return {
      label: 'stale card',
      dot: 'bg-amber-500',
      pulse: false,
      badge:
        'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500',
      border: '',
    };
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
        <NuxtLink
          :to="`/agents/${peer.peerAgentId}`"
          class="text-sm font-bold hover:underline"
        >
          {{ peer.peerName }}
        </NuxtLink>
        <Badge variant="outline" :class="meta.badge">{{ meta.label }}</Badge>
        <span class="text-xs text-muted-foreground">
          {{ taskCount }} {{ taskCount === 1 ? 'task' : 'tasks' }}
        </span>

        <div class="ml-auto flex gap-1">
          <Button
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

      <p class="mt-1.5 text-sm text-muted-foreground">
        {{ peer.card?.description }}
      </p>

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
        <span v-else class="text-xs text-muted-foreground">
          Advertises nothing — this agent has no way to tell when to ask it.
        </span>
        <span
          class="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
        >
          card read
          <DateTimeAgo :date="peer.cardReadAt" class="!items-start" />
        </span>
      </div>
    </div>
  </div>
</template>
