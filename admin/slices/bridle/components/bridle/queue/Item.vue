<script setup lang="ts">
import { computed } from "vue";
import {
  GripVertical,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Trash2,
} from "lucide-vue-next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#theme/components/ui/dropdown-menu";
import type { IQueuedMessage } from "../../../utils/queue";

// One waiting message (CLEAN-245). The row is the thing that moves: it takes
// focus, Alt+↑ / Alt+↓ on it are the parent's (`useQueueOrder`), and its
// handle is what a drag starts on. Everything it can do is also in the `⋯`
// menu, so nothing depends on a pointer or on finding a small icon.
const props = defineProps<{
  entry: IQueuedMessage;
  index: number;
  total: number;
  /** This row is the one being dragged. */
  dragging?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  remove: [];
  move: [to: number];
}>();

// A message of files only has no words to show: its files' names stand in.
const label = computed(
  () =>
    props.entry.text || props.entry.attachments.map((a) => a.name).join(", "),
);
const position = computed(() => `${props.index + 1} of ${props.total}`);
const rowLabel = computed(() =>
  props.entry.blocked
    ? `Queued message ${position.value}, not sent: ${label.value}`
    : `Queued message ${position.value}: ${label.value}`,
);

const controlClass =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
</script>

<template>
  <li
    data-queue-row
    :data-queue-id="entry.id"
    :data-queue-blocked="entry.blocked ? '' : undefined"
    tabindex="0"
    :title="label"
    :aria-label="rowLabel"
    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
    class="flex items-center gap-1.5 px-2 py-1 text-sm outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    :class="dragging && 'opacity-50'"
  >
    <span
      data-queue-handle
      aria-hidden="true"
      class="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
      :class="total < 2 && 'invisible'"
    >
      <GripVertical class="size-4" />
    </span>

    <span
      class="min-w-0 flex-1 truncate"
      :class="entry.blocked && 'text-muted-foreground'"
    >
      {{ label }}
    </span>
    <span
      v-if="entry.blocked"
      class="shrink-0 text-xs text-destructive"
      data-queue-blocked-reason
    >
      File no longer allowed — edit or remove
    </span>
    <span
      v-else-if="entry.attachments.length"
      class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
      :aria-label="
        entry.attachments.length === 1
          ? '1 file'
          : `${entry.attachments.length} files`
      "
    >
      <Paperclip class="size-3.5" aria-hidden="true" />
      {{ entry.attachments.length }}
    </span>

    <button
      type="button"
      :class="controlClass"
      aria-label="Edit"
      title="Edit"
      @click="emit('edit')"
    >
      <Pencil class="size-3.5" aria-hidden="true" />
    </button>
    <button
      type="button"
      :class="controlClass"
      aria-label="Remove"
      title="Remove"
      @click="emit('remove')"
    >
      <Trash2 class="size-3.5" aria-hidden="true" />
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :class="controlClass"
          aria-label="More"
          title="More"
          data-queue-menu
        >
          <MoreHorizontal class="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-36">
        <DropdownMenuItem
          :disabled="index === 0"
          @select="emit('move', index - 1)"
        >
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="index === total - 1"
          @select="emit('move', index + 1)"
        >
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="emit('edit')">Edit</DropdownMenuItem>
        <DropdownMenuItem @select="emit('remove')">Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>
</template>
