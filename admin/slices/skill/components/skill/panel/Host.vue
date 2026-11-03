<script setup lang="ts">
import type { ISkillData } from '#skill/domain';
import type { SkillLayout } from '#skill/composables/useSkillLayout';

/**
 * One panel, three hosts (CLEAN-205, research R8): a sticky column from
 * 1280 px, a right drawer on tablets, a bottom sheet on phones. The drawer
 * and the sheet are the theme's Sheet (reka-ui Dialog underneath), which
 * supplies the focus trap, Esc, the backdrop click, the close button and
 * the focus return to the row that opened it. Open state is derived: a
 * selection on a non-desktop layout.
 */
const props = defineProps<{
  skill: ISkillData | null;
  layout: SkillLayout;
  totalTokens: number;
  deleting: boolean;
  confirmDeleteFor?: string | null;
}>();

const emit = defineEmits<{ close: []; delete: [skill: ISkillData] }>();

const open = computed(() => props.layout !== 'desktop' && props.skill !== null);

function onOpenChange(value: boolean) {
  if (!value) emit('close');
}

// Swipe the bottom sheet down to close: a pointer drag of 80 px on the grab
// handle, far enough to be a gesture and not a tap.
let grabY: number | null = null;
function grabStart(e: PointerEvent) {
  grabY = e.clientY;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function grabEnd(e: PointerEvent) {
  if (grabY !== null && e.clientY - grabY > 80) emit('close');
  grabY = null;
}
</script>

<template>
  <aside
    v-if="layout === 'desktop'"
    class="hidden w-[380px] shrink-0 xl:block"
  >
    <div class="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border bg-card p-5">
      <SkillPanel :skill="skill" :total-tokens="totalTokens" host="column" :deleting="deleting" :confirm-delete-for="confirmDeleteFor" @delete="emit('delete', $event)" />
    </div>
  </aside>

  <Sheet v-else :open="open" @update:open="onOpenChange">
    <SheetContent
      v-if="layout === 'tablet'"
      side="right"
      class="w-[min(420px,90vw)] overflow-y-auto p-5 sm:max-w-none motion-reduce:animate-none motion-reduce:transition-none"
    >
      <SheetHeader class="sr-only">
        <SheetTitle>{{ skill?.title ?? 'Skill' }}</SheetTitle>
        <SheetDescription>Skill details</SheetDescription>
      </SheetHeader>
      <SkillPanel :skill="skill" :total-tokens="totalTokens" host="drawer" :deleting="deleting" :confirm-delete-for="confirmDeleteFor" @delete="emit('delete', $event)" />
      <SheetFooter class="mt-4">
        <SheetClose as-child>
          <Button variant="outline">Back</Button>
        </SheetClose>
      </SheetFooter>
    </SheetContent>

    <SheetContent
      v-else
      side="bottom"
      class="h-[90vh] overflow-y-auto rounded-t-xl p-5 pt-2 motion-reduce:animate-none motion-reduce:transition-none"
    >
      <button
        type="button"
        class="mx-auto mb-3 flex h-8 w-full touch-none items-center justify-center"
        aria-label="Close details"
        @pointerdown="grabStart"
        @pointerup="grabEnd"
        @pointercancel="grabY = null"
        @click="emit('close')"
      >
        <span class="h-1.5 w-12 rounded-full bg-muted-foreground/40" aria-hidden="true" />
      </button>
      <SheetHeader class="sr-only">
        <SheetTitle>{{ skill?.title ?? 'Skill' }}</SheetTitle>
        <SheetDescription>Skill details</SheetDescription>
      </SheetHeader>
      <SkillPanel :skill="skill" :total-tokens="totalTokens" host="sheet" :deleting="deleting" :confirm-delete-for="confirmDeleteFor" @delete="emit('delete', $event)" />
      <SheetFooter class="mt-4">
        <SheetClose as-child>
          <Button variant="outline" class="min-h-11">Back</Button>
        </SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
