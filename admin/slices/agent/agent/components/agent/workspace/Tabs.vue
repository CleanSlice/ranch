<script setup lang="ts">
import { IconChevronDown } from '@tabler/icons-vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import {
  OVERFLOW_TABS,
  PRIMARY_TABS,
  type AgentTab,
  type SectionCounts,
} from './sections';

const props = defineProps<{
  active: AgentTab;
  counts: SectionCounts;
}>();

defineEmits<{ select: [tab: AgentTab] }>();

function countFor(countKey: string | null): number | null {
  if (!countKey) return null;
  return props.counts[countKey as keyof SectionCounts] ?? null;
}

// The overflow menu highlights itself when what it holds is what is open —
// otherwise the operator loses track of where they are the moment they pick
// something from it.
const overflowActive = computed(() =>
  OVERFLOW_TABS.some((t) => t.value === props.active),
);

const activeOverflowTitle = computed(
  () => OVERFLOW_TABS.find((t) => t.value === props.active)?.title ?? null,
);
</script>

<template>
  <div class="flex shrink-0 items-center gap-1 border-b" role="tablist">
    <button
      v-for="t in PRIMARY_TABS"
      :key="t.value"
      type="button"
      role="tab"
      :aria-selected="active === t.value"
      :title="t.desc"
      class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors"
      :class="
        active === t.value
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      "
      @click="$emit('select', t.value)"
    >
      {{ t.title }}
      <!-- `null` renders nothing at all; `0` renders as 0, because "none
           attached" is real information and must not read as "unknown". -->
      <span
        v-if="countFor(t.countKey) !== null"
        class="rounded bg-muted px-1 text-xs tabular-nums text-muted-foreground"
      >
        {{ countFor(t.countKey) }}
      </span>
    </button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            overflowActive
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
        >
          {{ activeOverflowTitle ?? 'More' }}
          <IconChevronDown class="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-48">
        <DropdownMenuItem
          v-for="t in OVERFLOW_TABS"
          :key="t.value"
          class="cursor-pointer"
          @select="$emit('select', t.value)"
        >
          <span class="flex-1">{{ t.title }}</span>
          <span
            v-if="countFor(t.countKey) !== null"
            class="text-xs tabular-nums text-muted-foreground"
          >
            {{ countFor(t.countKey) }}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
