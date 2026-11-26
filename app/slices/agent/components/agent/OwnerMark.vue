<script setup lang="ts">
import type { OwnerMarkTypes } from '#agent/utils/agentOwnership';

/**
 * Who made the agent, on the corner of its avatar (CLEAN-259): filled with
 * a person for the viewer's own, outlined with the creator's initials for
 * somebody else's (operators only). The same badge in the rail, on the map
 * and in the sheet.
 *
 * The person is drawn solid: as an outline it is two thin strokes at this
 * size and reads as a smudge; filled, it is a figure. No letter, so nothing
 * to translate and no font to load.
 *
 * Bottom-left, in all three: the one corner nothing else uses. On the map
 * the pin is top-left, the Ranch admin dot top-right and the status pulse
 * bottom-right.
 *
 * Decoration: the words are in the accessible name of whatever carries the
 * avatar (the row, the node, the sheet's class line), so this is hidden from
 * a screen reader. The two kinds differ by fill and by content, not by
 * colour alone. The parent is `relative`, and may name the surface the badge
 * is cut out of with `--owner-mark-ring`.
 */
defineProps<{
  mark: OwnerMarkTypes | null;
  /** On the sheet's open avatar (48 px); 36 to 40 px avatars take the default. */
  large?: boolean;
}>();
</script>

<template>
  <span
    v-if="mark"
    class="agent-owner-mark"
    :class="[
      mark.kind === 'mine' ? 'agent-owner-mark--mine' : 'agent-owner-mark--other',
      large && 'agent-owner-mark--large',
    ]"
    :data-owner-mark="mark.kind"
    :title="mark.kind === 'mine' ? $t('ownership.mine') : $t('ownership.by', { name: mark.name })"
    aria-hidden="true"
  >
    <Icon v-if="mark.kind === 'mine'" name="user-round" :size="large ? 13 : 11" />
    <template v-else>{{ mark.initials }}</template>
  </span>
</template>

<style scoped>
.agent-owner-mark {
  position: absolute;
  left: -6px;
  bottom: -6px;
  z-index: 1;
  display: grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 3px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  /* Cuts the badge out of the avatar it sits on. */
  box-shadow: 0 0 0 2px var(--owner-mark-ring, var(--background));
}
.agent-owner-mark--mine {
  background: var(--primary);
  color: var(--primary-foreground);
}
.agent-owner-mark--mine :deep(svg) {
  fill: currentColor;
}
.agent-owner-mark--other {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid color-mix(in oklab, var(--foreground) 55%, transparent);
}
.agent-owner-mark--large {
  left: -7px;
  bottom: -7px;
  min-width: 20px;
  height: 20px;
  border-radius: 7px;
  font-size: 10.5px;
}
</style>
