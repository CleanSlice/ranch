<script lang="ts" setup>
import { useTimeAgoIntl } from '@vueuse/core';

const { date, class: className } = defineProps<{
    date: string;
    class?: string;
}>();
const { locale } = useI18n();
// Getter (not a plain Date) so it re-evaluates if `date` changes.
const timeAgoIntl = useTimeAgoIntl(() => new Date(date || Date.now()), { locale: locale.value });
const timeAgo = computed(() => (date ? timeAgoIntl.value : ''));
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