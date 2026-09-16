<script lang="ts" setup>
import { useTimeAgoIntl } from '@vueuse/core';

/**
 * One-line relative time for inline meta ("card read 5 minutes ago") where
 * the two-line DateTimeAgo would wrap. The absolute date lives in the title
 * tooltip. Same Intl source as DateTimeAgo, so the wording matches.
 */
const { date } = defineProps<{ date: string }>();
const { locale } = useI18n();
// Getter (not a plain Date) so it re-evaluates if `date` changes.
const timeAgo = useTimeAgoIntl(() => new Date(date || Date.now()), {
    locale: locale.value,
});
</script>
<template>
    <span v-if="date" :title="formatDateTime(date)">{{ timeAgo }}</span>
    <span v-else>—</span>
</template>
