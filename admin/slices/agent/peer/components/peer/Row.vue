<script setup lang="ts">
import { IconDots, IconRefresh, IconTrash } from '@tabler/icons-vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { AGENT_STATUS_VARIANT } from '#agent/utils/agentFormat';
import type { AgentStatusTypes } from '#agent/domain';
import type { IAgentPeer } from '#peer/stores/peer';

const props = defineProps<{
  peer: IAgentPeer;
  busy?: boolean;
  /** Set when another peer advertises the same thing — see Tab.vue. */
  warning?: string | null;
}>();

defineEmits<{ refresh: []; remove: [] }>();

const SKILLS_SHOWN = 4;

const skills = computed(() => props.peer.card?.skills ?? []);
const shown = computed(() => skills.value.slice(0, SKILLS_SHOWN));
const overflow = computed(() => Math.max(0, skills.value.length - SKILLS_SHOWN));

const statusVariant = computed(
  () =>
    AGENT_STATUS_VARIANT[props.peer.peerStatus as AgentStatusTypes] ?? 'outline',
);
</script>

<template>
  <div class="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
    <div class="min-w-0 space-y-1.5">
      <div class="flex items-center gap-2">
        <NuxtLink
          :to="`/agents/${peer.peerAgentId}`"
          class="font-medium hover:underline"
        >
          {{ peer.peerName }}
        </NuxtLink>
        <Badge v-if="peer.peerExists" :variant="statusVariant">
          {{ peer.peerStatus }}
        </Badge>
        <Badge v-else variant="destructive">gone</Badge>
      </div>

      <p class="text-sm text-muted-foreground">
        {{ peer.card?.description }}
      </p>

      <ul v-if="shown.length" class="flex flex-wrap gap-1.5">
        <li v-for="skill in shown" :key="skill.id">
          <Badge variant="outline" :title="skill.description">
            {{ skill.name }}
          </Badge>
        </li>
        <li v-if="overflow">
          <Badge variant="outline">+{{ overflow }}</Badge>
        </li>
      </ul>
      <p v-else class="text-sm text-muted-foreground">
        Advertises nothing — this agent has no way to tell when to ask it.
      </p>

      <!-- Two peers whose cards read alike are not blocked, but the model will
           be choosing between them by chance, and nothing else in the product
           would ever tell an operator that. -->
      <p v-if="warning" class="text-sm text-amber-600 dark:text-amber-500">
        {{ warning }}
      </p>

      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Card read</span>
        <DateTimeAgo :date="peer.cardReadAt" class="!items-start" />
      </div>
    </div>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" :disabled="busy" aria-label="Peer actions">
          <IconDots class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @select="$emit('refresh')">
          <IconRefresh class="mr-2 size-4" />
          Refresh card
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" @select="$emit('remove')">
          <IconTrash class="mr-2 size-4" />
          Remove peer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
