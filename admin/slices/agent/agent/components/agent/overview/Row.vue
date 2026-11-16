<script setup lang="ts">
/**
 * One labelled row of an Overview block (CLEAN-228): the label on the left,
 * with an optional small hint under it, and the control on the right. Two
 * columns on a wide panel, stacked on a narrow one; a line between rows, none
 * above the first.
 *
 * `for` ties the label to the control when the control is a single field;
 * leave it out for a group (a choice, a pair of fields) and the label is
 * plain text.
 */
defineProps<{
  label: string
  for?: string
}>()
</script>

<template>
  <div
    class="grid grid-cols-1 items-start gap-x-5 gap-y-2 border-t py-3.5 first:border-t-0 @[460px]:grid-cols-[170px_minmax(0,1fr)]"
    data-row
  >
    <component
      :is="$props.for ? 'label' : 'div'"
      :for="$props.for"
      class="text-[13.5px] font-medium @[460px]:pt-[7px]"
    >
      {{ label }}
      <small
        v-if="$slots.hint"
        class="mt-0.5 block text-xs font-normal text-muted-foreground"
      >
        <slot name="hint" />
      </small>
    </component>
    <div class="flex min-w-0 flex-col gap-2">
      <slot />
    </div>
  </div>
</template>
