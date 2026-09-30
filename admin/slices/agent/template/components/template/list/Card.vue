<script setup lang="ts">
import type { ITemplateData } from '#template/domain';
import {
  agentsLabel,
  capabilitiesLabel,
  cpuLabel,
  imageTag,
  memoryLabel,
} from '#template/utils/templateFormat';
import { formatDate } from '#common/utils/format';
import TemplateTile from '../Tile.vue';
import TemplateListActions from './Actions.vue';

/**
 * One template in the cards view (CLEAN-130): who it is, what it gives an
 * agent (resources, skills, MCP servers) and whether anything runs on it.
 */
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
const tag = computed(() => imageTag(props.template.image));
</script>

<template>
  <NuxtLink
    :to="`/templates/${template.id}`"
    class="flex min-h-[200px] flex-col gap-3.5 rounded-[14px] border bg-card p-[18px] text-card-foreground shadow-xs transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <div class="flex items-start gap-3">
      <TemplateTile :id="template.id" :name="template.name" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[14.5px] font-semibold tracking-tight">{{ template.name }}</span>
          <Badge v-if="managed" variant="outline" class="shrink-0 border-violet-200 bg-violet-50 px-1.5 text-[10.5px] text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Managed
          </Badge>
        </div>
        <div class="text-xs text-muted-foreground">Created {{ formatDate(template.createdAt) }}</div>
      </div>
      <TemplateListActions
        :template-id="template.id"
        class="-mr-1.5 -mt-1"
        @restart="$emit('restart')"
        @remove="$emit('remove')"
      />
    </div>

    <p class="line-clamp-2 flex-1 text-[13.5px] leading-normal text-muted-foreground">
      {{ template.description || 'No description.' }}
    </p>

    <div class="flex flex-wrap items-center gap-1.5">
      <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ cpu }}</code>
      <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ memory }}</code>
      <span class="ml-1 text-xs text-muted-foreground">{{ capabilities }}</span>
    </div>

    <div class="-mx-[18px] -mb-[18px] flex items-center gap-2 border-t px-[18px] py-2.5 text-[12.5px] text-muted-foreground">
      <span
        class="size-[7px] rounded-full"
        :class="running ? 'bg-emerald-500' : 'bg-muted-foreground/30'"
      />
      {{ agents }}
      <code class="ml-auto truncate font-mono text-[11px] text-muted-foreground/70" :title="template.image">{{ tag }}</code>
    </div>
  </NuxtLink>
</template>
