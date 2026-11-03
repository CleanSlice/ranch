<script setup lang="ts">
import type { ISkillData } from '#skill/domain';
import { activityOf } from '#skill/utils/activity';

const props = defineProps<{ skill: ISkillData }>();

// Created / Imported and Last edited: all the API can say about a skill's
// history today (no audit log — spec FR-006).
const entries = computed(() => activityOf(props.skill));
</script>

<template>
  <ul class="flex flex-col gap-1.5">
    <SkillPanelActivityEntry v-for="e in entries" :key="e.kind" :entry="e" />
  </ul>
</template>
