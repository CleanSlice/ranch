<script setup lang="ts">
import type { ITemplateData } from '#template/domain';
import {
  agentsLabel,
  capabilitiesLabel,
  cpuLabel,
  memoryLabel,
} from '#template/utils/templateFormat';
import { formatDate } from '#common/utils/format';
import TemplateTile from '../Tile.vue';
import TemplateListActions from './Actions.vue';

/** One template in the table view (CLEAN-130); same facts as the card, one line each. */
const props = defineProps<{
  template: ITemplateData;
  running: number;
  managed: boolean;
}>();

defineEmits<{ restart: []; remove: [] }>();

const cpu = computed(() => cpuLabel(props.template.defaultResources.cpu));
const memory = computed(() => memoryLabel(props.template.defaultResources.memory));
const agents = computed(() => agentsLabel(props.running));
const capabilities = computed(() =>
  capabilitiesLabel(props.template.skillIds.length, props.template.mcpServerIds.length),
);
</script>

<template>
  <NuxtLink
    :to="`/templates/${template.id}`"
    class="grid items-center gap-4 border-b px-[18px] py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40 grid-cols-[minmax(0,1fr)_44px] md:grid-cols-[minmax(0,1fr)_170px_140px_150px_110px_44px]"
  >
    <div class="flex min-w-0 items-center gap-3">
      <TemplateTile :id="template.id" :name="template.name" size="sm" />
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-sm font-medium">{{ template.name }}</span>
          <Badge v-if="managed" variant="outline" class="shrink-0 border-violet-200 bg-violet-50 px-1.5 text-[10.5px] text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Managed
          </Badge>
        </div>
        <div class="truncate text-[12.5px] text-muted-foreground">{{ template.description }}</div>
      </div>
    </div>
    <div class="hidden gap-1.5 md:flex">
      <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ cpu }}</code>
      <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ memory }}</code>
    </div>
    <span class="hidden text-[12.5px] text-muted-foreground md:block">{{ capabilities }}</span>
    <span class="hidden items-center gap-1.5 text-[12.5px] text-muted-foreground md:flex">
      <span
        class="size-[7px] rounded-full"
        :class="running ? 'bg-emerald-500' : 'bg-muted-foreground/30'"
      />
      {{ agents }}
    </span>
    <span class="hidden text-[12.5px] text-muted-foreground md:block">{{ formatDate(template.createdAt) }}</span>
    <TemplateListActions
      :template-id="template.id"
      @restart="$emit('restart')"
      @remove="$emit('remove')"
    />
  </NuxtLink>
</template>
