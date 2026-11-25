<script setup lang="ts">
import type { IQueuedMessage } from "#bridle/utils/queue";

// One waiting message (CLEAN-245). The row is the thing that moves: it takes
// focus, Alt+↑ / Alt+↓ on it are the parent's (`useQueueOrder`), and its
// handle is what a drag starts on. Everything it can do is also in the `⋯`
// menu, so nothing depends on a pointer or on finding a small icon. Twin of
// admin's `bridle/queue/Item.vue`; the menu is built here because this
// console's kit has none.
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

// ── The `⋯` menu ───────────────────────────────────────────────
const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);

const items = (): HTMLButtonElement[] =>
  Array.from(
    menuEl.value?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) ?? [],
  );

async function openMenu() {
  menuOpen.value = true;
  await nextTick();
  items()[0]?.focus();
}

function closeMenu(refocus = true) {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (refocus) triggerEl.value?.focus();
}

function onMenuKeydown(e: KeyboardEvent) {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    list[(at + 1) % list.length]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    list[(at - 1 + list.length) % list.length]?.focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    list[0]?.focus();
  } else if (e.key === "End") {
    e.preventDefault();
    list[list.length - 1]?.focus();
  } else if (e.key === "Tab") {
    closeMenu(false);
  }
}

/** A press anywhere outside the menu and its button closes it. */
function onDocumentPointerDown(e: PointerEvent) {
  const target = e.target as Node | null;
  if (menuEl.value?.contains(target) || triggerEl.value?.contains(target))
    return;
  closeMenu(false);
}

watch(menuOpen, (open) => {
  if (open)
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
  else document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", onDocumentPointerDown, true),
);

function choose(action: () => void) {
  // A move keeps the focus on the row (the parent puts it there); the others
  // take the row away, so there is nothing to return it to.
  closeMenu(false);
  action();
}

const controlClass =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const menuItemClass =
  "flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";
</script>

<template>
  <li
    data-queue-row
    :data-queue-id="entry.id"
    :data-queue-blocked="entry.blocked ? '' : undefined"
    tabindex="0"
    :title="label"
    :aria-label="
      $t(entry.blocked ? 'chat.queue_row_blocked' : 'chat.queue_row', {
        position: index + 1,
        total,
        text: label,
      })
    "
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
      <Icon name="grip-vertical" :size="16" />
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
      {{ $t("chat.queue_blocked") }}
    </span>
    <span
      v-else-if="entry.attachments.length"
      class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
      :aria-label="
        $t(
          'chat.queue_files',
          { count: entry.attachments.length },
          entry.attachments.length,
        )
      "
    >
      <Icon name="paperclip" :size="14" aria-hidden="true" />
      {{ entry.attachments.length }}
    </span>

    <button
      type="button"
      :class="controlClass"
      :aria-label="$t('chat.queue_edit')"
      :title="$t('chat.queue_edit')"
      @click="emit('edit')"
    >
      <Icon name="pencil" :size="14" aria-hidden="true" />
    </button>
    <button
      type="button"
      :class="controlClass"
      :aria-label="$t('chat.queue_remove')"
      :title="$t('chat.queue_remove')"
      @click="emit('remove')"
    >
      <Icon name="trash-2" :size="14" aria-hidden="true" />
    </button>
    <div class="relative shrink-0">
      <button
        ref="triggerEl"
        type="button"
        :class="controlClass"
        :aria-label="$t('chat.queue_more')"
        :title="$t('chat.queue_more')"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        data-queue-menu
        @click="menuOpen ? closeMenu() : openMenu()"
      >
        <Icon name="more-horizontal" :size="16" aria-hidden="true" />
      </button>
      <!-- Opens upwards: the panel sits at the bottom of the chat. -->
      <div
        v-if="menuOpen"
        ref="menuEl"
        role="menu"
        class="absolute bottom-full right-0 z-20 mb-1 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        @keydown="onMenuKeydown"
      >
        <button
          type="button"
          role="menuitem"
          :class="menuItemClass"
          :disabled="index === 0"
          @click="choose(() => emit('move', index - 1))"
        >
          {{ $t("chat.queue_move_up") }}
        </button>
        <button
          type="button"
          role="menuitem"
          :class="menuItemClass"
          :disabled="index === total - 1"
          @click="choose(() => emit('move', index + 1))"
        >
          {{ $t("chat.queue_move_down") }}
        </button>
        <div class="-mx-1 my-1 h-px bg-border" role="separator" />
        <button
          type="button"
          role="menuitem"
          :class="menuItemClass"
          @click="choose(() => emit('edit'))"
        >
          {{ $t("chat.queue_edit") }}
        </button>
        <button
          type="button"
          role="menuitem"
          :class="menuItemClass"
          @click="choose(() => emit('remove'))"
        >
          {{ $t("chat.queue_remove") }}
        </button>
      </div>
    </div>
  </li>
</template>
