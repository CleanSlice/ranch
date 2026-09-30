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

/**
 * One template in the table view (CLEAN-130): the same facts as the card,
 * one line each, on the shared Table so it looks like every other admin
 * table (CLEAN-132). The row opens the template; the name is a real link
 * for the keyboard.
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
</script>

<template>
  <TableRow class="cursor-pointer" @click="navigateTo(`/templates/${template.id}`)">
    <TableCell class="max-w-md whitespace-normal">
      <div class="flex min-w-0 items-center gap-3">
        <TemplateTile :id="template.id" :name="template.name" size="sm" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <div class="flex items-center gap-1.5">
            <NuxtLink :to="`/templates/${template.id}`" class="truncate text-sm font-medium" @click.stop>
              {{ template.name }}
            </NuxtLink>
            <Badge v-if="managed" variant="outline" class="shrink-0 border-violet-200 bg-violet-50 px-1.5 text-[10.5px] text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
              Managed
            </Badge>
          </div>
          <div class="truncate text-[12.5px] text-muted-foreground">{{ template.description }}</div>
        </div>
      </div>
    </TableCell>
    <TableCell>
      <div class="flex gap-1.5">
        <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ cpu }}</code>
        <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{{ memory }}</code>
      </div>
    </TableCell>
    <TableCell class="text-[12.5px] text-muted-foreground">{{ capabilities }}</TableCell>
    <TableCell>
      <span class="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span class="size-[7px] rounded-full" :class="running ? 'bg-emerald-500' : 'bg-muted-foreground/30'" />
        {{ agents }}
      </span>
    </TableCell>
    <TableCell class="text-[12.5px] text-muted-foreground">{{ formatDate(template.createdAt) }}</TableCell>
    <TableCell class="text-right" @click.stop>
      <TemplateListActions
        :template-id="template.id"
        @restart="$emit('restart')"
        @remove="$emit('remove')"
      />
    </TableCell>
  </TableRow>
</template>
