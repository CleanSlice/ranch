<script setup lang="ts">
import {
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconShield,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';
import type { IAgentData } from '#agent/domain';
import { agentInitials } from '#agent/composables/useAgentRailEntries';
import {
  AGENT_SETTINGS_SECTIONS,
  type AgentSettingsSection,
  type SectionCounts,
} from './sections';

const props = defineProps<{
  agent: IAgentData;
  /** Which section the canvas is showing, so the list can mark it. */
  section: AgentSettingsSection | null;
  counts: SectionCounts;
  canStop: boolean;
  toggling: boolean;
  isRestarting: boolean;
  lifecycleError: string | null;
}>();

const emit = defineEmits<{
  'update:section': [AgentSettingsSection | null];
  restart: [];
  toggleRunning: [];
  close: [];
  deleted: [];
}>();

const agentStore = useAgentStore();

const initials = computed(() =>
  agentInitials(props.agent.name, props.agent.id),
);

// The lifecycle actions the table's row menu used to carry. They live here
// rather than in the rail because a rail entry identifies an agent and does
// not act on one (FR-002, FR-009, FR-017).
const confirmRemoveOpen = ref(false);
const removing = ref(false);
const removeError = ref<string | null>(null);

async function onRemove() {
  if (removing.value) return;
  removing.value = true;
  removeError.value = null;
  try {
    await agentStore.remove(props.agent.id);
    emit('deleted');
  } catch (err) {
    removeError.value = (err as Error).message || 'Delete failed';
  } finally {
    removing.value = false;
  }
}

function countFor(countKey: string | null): number | null {
  if (!countKey) return null;
  return props.counts[countKey as keyof SectionCounts] ?? null;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
    >
      <span class="text-sm font-medium">Agent settings</span>
      <Button
        variant="ghost"
        size="sm"
        class="-mr-2 size-7 p-0"
        title="Hide settings"
        @click="emit('close')"
      >
        <IconX class="size-4" />
        <span class="sr-only">Hide settings</span>
      </Button>
    </div>

    <!-- Identity: everything the table row said about an agent besides its
         name, plus the failure reason when there is one. -->
    <div class="flex shrink-0 items-start gap-3 border-b px-4 py-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary"
      >
        {{ initials }}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-sm font-medium" :title="agent.name">
            {{ agent.name }}
          </span>
          <IconShield
            v-if="agent.isAdmin"
            class="size-3.5 shrink-0 text-primary"
            title="This agent has the ranch_* admin tools and a service token"
          />
        </div>
        <p class="mt-0.5 truncate text-xs text-muted-foreground" :title="agent.id">
          {{ agent.id }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          <Badge
            :variant="AGENT_STATUS_VARIANT[agent.status]"
            class="capitalize"
          >
            {{ agent.status }}
          </Badge>
          <span class="ml-1.5">
            {{ agent.resources.cpu }} / {{ agent.resources.memory }}
          </span>
        </p>
        <p
          v-if="agent.status === 'failed' && agent.statusReason"
          class="mt-1 text-xs text-destructive"
        >
          {{ agent.statusReason }}
        </p>
      </div>
    </div>

    <!-- Navigator. Rows only — the section itself renders in the canvas. -->
    <nav class="min-h-0 flex-1 overflow-y-auto p-2">
      <ul class="flex flex-col gap-0.5">
        <li v-for="s in AGENT_SETTINGS_SECTIONS" :key="s.value">
          <AgentSettingsNavItem
            :section="s"
            :count="countFor(s.countKey)"
            :current="section === s.value"
            @select="emit('update:section', s.value)"
          />
        </li>
      </ul>
    </nav>

    <div class="shrink-0 border-t p-3">
      <p
        v-if="lifecycleError || removeError"
        class="mb-2 text-xs text-destructive"
      >
        {{ lifecycleError || removeError }}
      </p>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="flex-1"
          :disabled="toggling || isRestarting"
          :title="
            canStop
              ? 'Cancel the workflow and delete the pod to free cluster resources'
              : 'Deploy a fresh pod'
          "
          @click="emit('toggleRunning')"
        >
          <IconLoader2 v-if="toggling" class="size-4 animate-spin" />
          <IconPlayerStop v-else-if="canStop" class="size-4" />
          <IconPlayerPlay v-else class="size-4" />
          {{
            toggling
              ? canStop
                ? 'Stopping…'
                : 'Starting…'
              : canStop
                ? 'Stop'
                : 'Start'
          }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="flex-1"
          :disabled="isRestarting || toggling"
          @click="emit('restart')"
        >
          <IconLoader2 v-if="isRestarting" class="size-4 animate-spin" />
          <IconRefresh v-else class="size-4" />
          {{ isRestarting ? 'Restarting…' : 'Restart' }}
        </Button>
        <Button size="sm" class="flex-1" as-child>
          <NuxtLink :to="`/agents/${agent.id}/edit`">Edit</NuxtLink>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="size-8 shrink-0 p-0 text-destructive hover:text-destructive"
          title="Delete agent"
          :disabled="removing"
          @click="confirmRemoveOpen = true"
        >
          <IconLoader2 v-if="removing" class="size-4 animate-spin" />
          <IconTrash v-else class="size-4" />
          <span class="sr-only">Delete agent</span>
        </Button>
      </div>
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete agent"
      :description="`Permanently delete agent “${agent.name}”? This cannot be undone.`"
      confirm-label="Delete agent"
      :busy="removing"
      @confirm="onRemove"
    />
  </div>
</template>
