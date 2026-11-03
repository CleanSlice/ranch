<script setup lang="ts">
import { GripVertical, MoreHorizontal } from 'lucide-vue-next';
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDateTime } from '#common/utils/format';
import type { ISkillData } from '#skill/domain';
import { groupMeta } from '#skill/domain/skill.groups';
import type { SkillLayout } from '#skill/composables/useSkillLayout';
import { isRecent } from '#skill/utils/editTime';
import { formatTokens } from '#skill/utils/formatTokens';

const props = defineProps<{
  skill: ISkillData;
  selected: boolean;
  layout: SkillLayout;
  /** Visible position, 1-based, and the visible count — for the handle's name. */
  position: number;
  total: number;
  /** Dragging is on (custom order, and on a phone the Reorder mode). */
  dragEnabled: boolean;
  /** Why the handle is off, when it is. */
  dragHint: string | null;
  /** `↑2` / `↓1` against the saved order, or empty. */
  badge: string;
  dragging: boolean;
  /** Ticks once a minute so the green dot ages out without a reload. */
  now: Date;
}>();

const emit = defineEmits<{
  select: [];
  /** Keyboard: move this row by ±1 visible position. */
  move: [delta: number];
  delete: [];
}>();

const meta = computed(() => groupMeta(props.skill.group));
const relative = useRelativeTime(() => props.skill.updatedAt);
const recent = computed(() => isRecent(props.skill.updatedAt, props.now));

const templates = computed(() => {
  const list = props.skill.templates;
  if (list.length === 0) return { text: 'Not in any template', title: 'Not attached to any template', warn: true };
  if (list.length === 1) return { text: list[0]!.name, title: list[0]!.name, warn: false };
  return {
    text: `${list.length} templates`,
    title: list.map((t) => t.name).join(', '),
    warn: false,
  };
});

const handleLabel = computed(
  () => `Reorder ${props.skill.name}, position ${props.position} of ${props.total}. Use arrow keys to move.`,
);

const showHandle = computed(() => props.layout !== 'phone' || props.dragEnabled);
</script>

<template>
  <li
    :data-skill-row="skill.name"
    :aria-current="selected ? 'true' : undefined"
    :data-moved="badge || undefined"
    class="relative flex gap-3 border-b px-3 py-3 transition-colors last:border-b-0 motion-reduce:transition-none"
    :class="[selected ? 'bg-accent/50' : 'hover:bg-accent/20', dragging && 'opacity-50']"
    @click="emit('select')"
  >
    <button
      v-if="showHandle"
      type="button"
      :data-skill-handle="skill.name"
      :aria-label="handleLabel"
      :disabled="!dragEnabled"
      :title="dragHint ?? undefined"
      class="-ml-1 flex min-h-11 w-6 shrink-0 touch-none items-center justify-center self-start rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      :class="dragEnabled && 'cursor-grab active:cursor-grabbing'"
      @click.stop
      @keydown.up.prevent="emit('move', -1)"
      @keydown.down.prevent="emit('move', 1)"
    >
      <GripVertical class="size-4" aria-hidden="true" />
    </button>

    <span class="w-[3px] shrink-0 self-stretch rounded-full" :class="meta.mark" aria-hidden="true" />

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <button
          type="button"
          class="text-left font-semibold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          @click.stop="emit('select')"
        >
          {{ skill.title }}
        </button>
        <code class="text-xs text-muted-foreground [overflow-wrap:anywhere]">{{ skill.name }}</code>
        <span
          v-if="badge"
          class="rounded bg-primary/10 px-1.5 text-xs font-medium tabular-nums text-primary"
          :aria-label="`Moved ${badge}`"
        >
          {{ badge }}
        </span>
      </div>

      <p v-if="skill.description" class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
        {{ skill.description }}
      </p>

      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span class="rounded px-1.5 py-0.5 font-medium" :class="meta.chip">{{ meta.label }}</span>
        <span class="tabular-nums">≈ {{ formatTokens(skill.tokenEstimate) }} tokens</span>
        <span
          :title="templates.title"
          :class="templates.warn && 'text-amber-700 dark:text-amber-400'"
        >
          {{ templates.text }}
        </span>
        <time
          :datetime="skill.updatedAt"
          :title="formatDateTime(skill.updatedAt)"
          class="inline-flex items-center gap-1.5"
        >
          <span v-if="recent" class="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span v-if="recent" class="sr-only">Recently</span>
          Edited {{ relative }}
        </time>
      </div>
    </div>

    <div class="shrink-0 self-start" @click.stop>
      <Button v-if="layout !== 'phone'" size="sm" variant="outline" as-child>
        <NuxtLink :to="`/skills/${skill.id}/edit`">Edit</NuxtLink>
      </Button>
      <DropdownMenu v-else>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-11"
            :data-skill-menu="skill.name"
            :aria-label="`More actions for ${skill.name}`"
          >
            <MoreHorizontal class="size-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem as-child>
            <NuxtLink :to="`/skills/${skill.id}/edit`">Edit</NuxtLink>
          </DropdownMenuItem>
          <DropdownMenuItem class="text-destructive" @select="emit('delete')">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </li>
</template>
