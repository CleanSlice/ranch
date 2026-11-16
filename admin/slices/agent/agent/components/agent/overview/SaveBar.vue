<script setup lang="ts">
/**
 * The one save of the Overview page (CLEAN-228, FR-016/FR-018): how many
 * fields are changed, Discard, Save — and "Save and restart" when CPU or
 * memory is among them, because those reach the pod only on its next start.
 *
 * Absent from the DOM while nothing is changed. It reads the page's draft by
 * injection and holds no state of its own beyond which button is spinning.
 *
 * `data-visibility-save` on Save is the name the CLEAN-224 browser scripts
 * already look for; it is kept on purpose.
 */
import { IconCheck, IconLoader2, IconRefresh } from '@tabler/icons-vue'
import { useInjectedAgentDraft } from '#agent/composables/useAgentDraft'

const draft = useInjectedAgentDraft()

// A save that carries limits moves the limit record at once and takes it back
// if the server refuses, so for the length of that request the draft counts
// nothing as changed. The bar must not leave on that: it would be gone before
// anything is saved, and back again after a refusal. While a save is running
// it stays, with the count it was sent with.
const sentCount = ref(0)
watch(
  draft.count,
  (count) => {
    if (count > 0) sentCount.value = count
  },
  { immediate: true },
)
const shown = computed(() => draft.isDirty.value || draft.saving.value)
const count = computed(() =>
  draft.count.value > 0 ? draft.count.value : sentCount.value,
)

const countText = computed(() =>
  count.value === 1 ? '1 unsaved change' : `${count.value} unsaved changes`,
)

// Which of the two buttons the running save came from.
const withRestart = ref(false)

async function onSave(restart: boolean) {
  if (draft.saving.value) return
  withRestart.value = restart
  await draft.save({ restart })
}
</script>

<template>
  <div
    v-if="shown"
    class="sticky bottom-3 z-10 flex flex-col gap-2"
    data-save-bar
    role="status"
  >
    <p
      v-if="draft.generalError.value"
      class="self-start rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-xs text-destructive shadow-sm"
      role="alert"
      data-save-error
    >
      {{ draft.generalError.value }}
    </p>
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-background py-2.5 pl-4 pr-3 text-[13.5px] shadow-[0_10px_30px_-10px_rgba(0,0,0,.25)]"
    >
      <p class="min-w-0">
        <span data-save-count>{{ countText }}</span><span
          v-if="draft.needsRestartOffer.value"
          class="text-muted-foreground"
          data-save-restart-note
        > · resources apply on restart</span>
      </p>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :disabled="draft.saving.value"
          data-save-discard
          @click="draft.discard()"
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="draft.needsRestartOffer.value ? 'outline' : 'default'"
          :disabled="draft.saving.value"
          data-visibility-save
          @click="onSave(false)"
        >
          <IconLoader2 v-if="draft.saving.value && !withRestart" class="size-4 animate-spin" />
          <IconCheck v-else class="size-4" />
          {{ draft.saving.value && !withRestart ? 'Saving…' : 'Save' }}
        </Button>
        <Button
          v-if="draft.needsRestartOffer.value"
          type="button"
          size="sm"
          :disabled="draft.saving.value"
          data-save-restart
          @click="onSave(true)"
        >
          <IconLoader2 v-if="draft.saving.value && withRestart" class="size-4 animate-spin" />
          <IconRefresh v-else class="size-4" />
          {{ draft.saving.value && withRestart ? 'Saving…' : 'Save and restart' }}
        </Button>
      </div>
    </div>
  </div>
</template>
