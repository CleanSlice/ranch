<script setup lang="ts">
import { IconShield } from '@tabler/icons-vue';
import type { IRailEntry } from '#agent/composables/useAgentRailEntries';

defineProps<{ entry: IRailEntry }>();
</script>

<template>
  <!-- Identity only: name, live status, when it was created, and the admin
       marker. No restart, no menu, no delete — a rail row picks an agent, it
       does not act on one (FR-002). -->
  <button
    type="button"
    class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
    :class="entry.isActive && 'bg-muted'"
    :aria-current="entry.isActive ? 'true' : undefined"
  >
    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
    >
      {{ entry.initials }}
    </span>

    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span
          class="truncate text-sm font-medium"
          :title="entry.name"
        >
          {{ entry.name }}
        </span>
        <IconShield
          v-if="entry.isAdmin"
          class="size-3.5 shrink-0 text-primary"
          title="This agent has the ranch_* admin tools and a service token"
        />
      </span>

      <span class="mt-0.5 flex items-center gap-1.5 text-xs">
        <span class="relative flex size-1.5">
          <span
            v-if="entry.tone.pulse"
            class="absolute inline-flex size-full animate-ping rounded-full opacity-60"
            :class="entry.tone.dot"
          />
          <span
            class="relative inline-flex size-1.5 rounded-full"
            :class="entry.tone.dot"
          />
        </span>
        <span class="capitalize" :class="entry.tone.text">
          {{ entry.status }}
        </span>
        <span class="text-muted-foreground/60">·</span>
        <span class="truncate text-muted-foreground">
          {{ formatDate(entry.createdAt) }}
        </span>
      </span>
    </span>
  </button>
</template>
