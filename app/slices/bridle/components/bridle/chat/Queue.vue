<script setup lang="ts">
import type { IBridleConversation } from "#bridle/stores/bridle";
import { useQueueOrder } from "#bridle/composables/useQueueOrder";
import type { QueueHeldReasons } from "#bridle/utils/queue";

// The messages written while the agent could not take them (CLEAN-245), in
// the order they will be sent. Sits directly above the composer and is only
// there while something waits. It shows and reorders; sending is the chat's
// (`Provider.vue` watches the agent and drains), and taking a row back for
// editing is the composer's, which owns the draft — hence `edit` going up.
// Twin of admin's `bridle/queue/Provider.vue`.
const props = defineProps<{
  conversation: IBridleConversation;
  /** Why nothing is being sent by itself, when that is so. */
  held: QueueHeldReasons | null;
}>();

const emit = defineEmits<{ edit: [id: string] }>();

const bridleStore = useBridleStore();
const queue = computed(() => bridleStore.queueFor(props.conversation.key));
const folded = computed(() =>
  bridleStore.isQueueFolded(props.conversation.key),
);

const listEl = ref<HTMLElement | null>(null);
const order = useQueueOrder({
  listEl,
  onMove: (from, to) => bridleStore.moveQueued(props.conversation, from, to),
});
const { dragging, dropSlot, indicatorTop, moved } = order;

const heldKey = computed(() => {
  if (props.held === "stale") return "chat.queue_held_stale";
  if (props.held) return "chat.queue_held_agent";
  return null;
});
</script>

<template>
  <section
    v-if="queue.length"
    class="rounded-xl border bg-card text-card-foreground shadow-sm"
    data-queue
    :data-queue-held="held ?? undefined"
  >
    <header class="flex items-center gap-2 py-1 pl-3 pr-2">
      <h3
        class="flex-1 text-xs font-medium text-muted-foreground"
        data-queue-count
      >
        {{ $t("chat.queue_title", { count: queue.length }) }}
      </h3>
      <button
        type="button"
        class="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="!folded"
        :aria-label="$t(folded ? 'chat.queue_show' : 'chat.queue_hide')"
        :title="$t(folded ? 'chat.queue_show' : 'chat.queue_hide')"
        data-queue-fold
        @click="bridleStore.setQueueFolded(conversation.key, !folded)"
      >
        <Icon
          name="chevron-down"
          :size="16"
          class="transition-transform motion-reduce:transition-none"
          :class="folded ? '-rotate-90' : undefined"
          aria-hidden="true"
        />
      </button>
    </header>

    <template v-if="!folded">
      <div
        v-if="heldKey"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
        role="status"
        data-queue-held-line
      >
        <span class="flex-1">{{ $t(heldKey) }}</span>
        <button
          v-if="held === 'stale'"
          type="button"
          class="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-queue-resume
          @click="bridleStore.resumeQueue(conversation)"
        >
          {{ $t("chat.queue_send_now") }}
        </button>
        <button
          type="button"
          class="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-queue-clear
          @click="bridleStore.clearQueue(conversation)"
        >
          {{ $t("chat.queue_clear") }}
        </button>
      </div>

      <ol
        ref="listEl"
        class="relative border-t py-0.5"
        :aria-label="$t('chat.queue_list')"
        @pointerdown="order.onPointerDown"
        @pointermove="order.onPointerMove"
        @pointerup="order.onPointerUp"
        @pointercancel="order.cancel"
      >
        <BridleChatQueueItem
          v-for="(entry, index) in queue"
          :key="entry.id"
          :entry="entry"
          :index="index"
          :total="queue.length"
          :dragging="dragging === index"
          @keydown="order.onRowKeydown($event, index)"
          @move="order.moveTo(index, $event)"
          @edit="emit('edit', entry.id)"
          @remove="bridleStore.removeQueued(conversation, entry.id)"
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

    <p class="sr-only" aria-live="polite" data-queue-moved>
      {{
        moved
          ? $t("chat.queue_moved", {
              position: moved.position,
              total: moved.total,
            })
          : ""
      }}
    </p>
  </section>
</template>
