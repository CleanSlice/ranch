<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown } from "lucide-vue-next";
import { useBridleStore } from "../../../stores/bridle";
import { useQueueOrder } from "../../../composables/useQueueOrder";
import type { QueueHeldReasons } from "../../../utils/queue";
import Item from "./Item.vue";

// The messages written while the agent could not take them (CLEAN-245), in
// the order they will be sent. Sits directly above the composer and is only
// there while something waits. It shows and reorders; sending is the host's
// (`../Provider.vue` watches the agent and drains), and taking a row back for
// editing is the composer's, which owns the draft — hence `edit` going up.
const props = defineProps<{
  conversationKey: string;
  /** Why nothing is being sent by itself, when that is so. */
  held: QueueHeldReasons | null;
}>();

const emit = defineEmits<{ edit: [id: string] }>();

const store = useBridleStore();
const queue = computed(() => store.getQueue(props.conversationKey));
const folded = computed(
  () => store.conversations[props.conversationKey]?.queueFolded ?? false,
);

const listEl = ref<HTMLElement | null>(null);
const order = useQueueOrder({
  listEl,
  onMove: (from, to) => store.moveQueued(props.conversationKey, from, to),
});
const { dragging, dropSlot, indicatorTop, moved } = order;

const movedLine = computed(() =>
  moved.value
    ? `Moved to position ${moved.value.position} of ${moved.value.total}.`
    : "",
);

const heldLine = computed(() => {
  if (props.held === "stale") return "These were written a while ago.";
  if (props.held) return "The agent did not start. Your messages are kept.";
  return null;
});
</script>

<template>
  <section
    v-if="queue.length"
    class="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
    data-queue
    :data-queue-held="held ?? undefined"
  >
    <header class="flex items-center gap-2 py-1 pr-2 pl-3">
      <h3 class="flex-1 text-xs font-medium text-muted-foreground">
        Queued ·
        <span class="tabular-nums" data-queue-count>{{ queue.length }}</span>
      </h3>
      <button
        type="button"
        class="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="!folded"
        :aria-label="folded ? 'Show queued messages' : 'Hide queued messages'"
        :title="folded ? 'Show queued messages' : 'Hide queued messages'"
        data-queue-fold
        @click="store.setQueueFolded(conversationKey, !folded)"
      >
        <ChevronDown
          class="size-4 transition-transform motion-reduce:transition-none"
          :class="folded && '-rotate-90'"
          aria-hidden="true"
        />
      </button>
    </header>

    <template v-if="!folded">
      <div
        v-if="heldLine"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
        role="status"
        data-queue-held-line
      >
        <span class="flex-1">{{ heldLine }}</span>
        <button
          v-if="held === 'stale'"
          type="button"
          class="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-queue-resume
          @click="store.resumeQueue(conversationKey)"
        >
          Send now
        </button>
        <button
          type="button"
          class="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-queue-clear
          @click="store.clearQueue(conversationKey)"
        >
          Clear queue
        </button>
      </div>

      <ol
        ref="listEl"
        class="relative border-t py-0.5"
        aria-label="Queued messages"
        @pointerdown="order.onPointerDown"
        @pointermove="order.onPointerMove"
        @pointerup="order.onPointerUp"
        @pointercancel="order.cancel"
      >
        <Item
          v-for="(entry, index) in queue"
          :key="entry.id"
          :entry="entry"
          :index="index"
          :total="queue.length"
          :dragging="dragging === index"
          @keydown="order.onRowKeydown($event, index)"
          @move="order.moveTo(index, $event)"
          @edit="emit('edit', entry.id)"
          @remove="store.removeQueued(conversationKey, entry.id)"
        />
        <!-- Where the dragged row will land. -->
        <li
          v-if="dragging !== null && dropSlot !== null"
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-2 h-0.5 -translate-y-px rounded-full bg-primary"
          :style="{ top: `${indicatorTop}px` }"
        />
      </ol>
    </template>

    <p class="sr-only" aria-live="polite" data-queue-moved>{{ movedLine }}</p>
  </section>
</template>
