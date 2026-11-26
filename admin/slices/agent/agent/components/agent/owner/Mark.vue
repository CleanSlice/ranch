<script setup lang="ts">
import { IconUserFilled } from '@tabler/icons-vue';
import { ownerMarkText, type OwnerMarkTypes } from '#agent/utils/agentOwnership';

/**
 * Who made the agent, on the corner of its avatar (CLEAN-259): filled with
 * a person for the viewer's own, outlined with the creator's initials for
 * somebody else's. The same badge in the rail and in the open agent's
 * header, and the same one the app console draws.
 *
 * Bottom-left in both places: in the header the status dot has the
 * bottom-right corner.
 *
 * Decoration: the words are in the row's name and in the header, so this is
 * hidden from a screen reader. The two kinds differ by fill and by content,
 * not by colour alone. The parent is `relative`, and may move the badge
 * further out of a small avatar with `--owner-mark-shift`.
 */
defineProps<{ mark: OwnerMarkTypes | null }>();
</script>

<template>
  <span
    v-if="mark"
    class="agent-owner-mark"
    :class="mark.kind === 'mine' ? 'agent-owner-mark--mine' : 'agent-owner-mark--other'"
    :data-owner-mark="mark.kind"
    :title="ownerMarkText(mark)"
    aria-hidden="true"
  >
    <IconUserFilled v-if="mark.kind === 'mine'" class="size-[11px]" />
    <template v-else>{{ mark.initials }}</template>
  </span>
</template>

<style scoped>
.agent-owner-mark {
  position: absolute;
  left: var(--owner-mark-shift, -6px);
  bottom: var(--owner-mark-shift, -6px);
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
  box-shadow: 0 0 0 2px var(--card);
}
.agent-owner-mark--mine {
  background: var(--primary);
  color: var(--primary-foreground);
}
.agent-owner-mark--other {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid color-mix(in oklab, var(--foreground) 55%, transparent);
}
</style>
