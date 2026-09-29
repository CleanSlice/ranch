<script lang="ts" setup>
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDateTime } from '#common/utils/format';

const { date, class: className } = defineProps<{
    date: string;
    class?: string;
}>();
// Getter (not a plain Date) so it re-evaluates if `date` changes.
const relativeTime = useRelativeTime(() => date);
const timeAgo = computed(() => (date ? relativeTime.value : ''));
</script>
<template>
    <div :class="cn('flex flex-col items-end leading-none', className)">
        <span class="text-right">{{ formatDateTime(date) }} </span>
        <slot v-if="date" name="value" :value="timeAgo">
            <span class="text-xs text-muted-foreground">
                {{ timeAgo }}
            </span>
        </slot>
    </div>
</template>


<style></style>