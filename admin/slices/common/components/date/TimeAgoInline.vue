<script lang="ts" setup>
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDateTime } from '#common/utils/format';

/**
 * One-line relative time for inline meta ("card read 5 minutes ago") where
 * the two-line DateTimeAgo would wrap. The absolute date lives in the title
 * tooltip. Same Intl source as DateTimeAgo, so the wording matches.
 */
const { date } = defineProps<{ date: string }>();
// Getter (not a plain Date) so it re-evaluates if `date` changes.
const timeAgo = useRelativeTime(() => date);
</script>
<template>
    <span v-if="date" :title="formatDateTime(date)">{{ timeAgo }}</span>
    <span v-else>—</span>
</template>
