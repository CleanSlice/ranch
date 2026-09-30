<script setup lang="ts">
import { IconBox, IconCheck, IconCopy } from '@tabler/icons-vue';
import type { IAgentData } from '#agent/domain';
import { TONE } from '#agent/composables/useAgentRailEntries';
import type { IMcpServerData } from '#mcpServer/domain';
import type { ISkillData } from '#skill/domain';
import type { ITemplateData } from '#template/domain';
import {
  AGENT_REFERENCE_CPU_MILLI,
  AGENT_REFERENCE_MEMORY_MI,
  cpuMilli,
  memoryMi,
  memoryStat,
  resourceShare,
} from '#template/utils/templateFormat';
import { formatDate } from '#common/utils/format';

/**
 * The Overview tab of a template (CLEAN-130): the runtime every agent starts
 * with, what is attached, and the agents that came from it. Read-only — the
 * Manage links jump to the tabs that edit.
 */
const props = defineProps<{
  template: ITemplateData;
  agents: IAgentData[];
  skills: ISkillData[];
  mcps: IMcpServerData[];
}>();

defineEmits<{ manageSkills: []; manageMcps: [] }>();

const cpu = computed(() => {
  const milli = cpuMilli(props.template.defaultResources.cpu);
  return {
    value: milli ? String(parseFloat((milli / 1000).toFixed(2))) : '—',
    share: resourceShare(milli, AGENT_REFERENCE_CPU_MILLI),
  };
});

const memory = computed(() => {
  const mem = props.template.defaultResources.memory;
  return {
    ...memoryStat(mem),
    share: resourceShare(memoryMi(mem), AGENT_REFERENCE_MEMORY_MI),
  };
});

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyImage() {
  try {
    await navigator.clipboard?.writeText(props.template.image);
  } catch {
    return;
  }
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1400);
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
    <div class="flex min-w-0 flex-col gap-4">
      <section class="flex flex-col gap-4 rounded-[14px] border bg-card p-5">
        <div class="flex items-center gap-2">
          <h2 class="text-[15px] font-semibold">Runtime</h2>
          <span class="text-[12.5px] text-muted-foreground/70">Defaults for every spawned agent</span>
        </div>
        <div class="flex items-center gap-2.5 rounded-[10px] border bg-muted/40 px-3 py-2.5">
          <IconBox class="size-4 shrink-0 text-muted-foreground" />
          <code class="min-w-0 flex-1 truncate font-mono text-[13px]">{{ template.image }}</code>
          <Button variant="outline" size="sm" class="h-6.5 px-2 text-xs" @click="copyImage">
            <IconCheck v-if="copied" class="size-3.5" />
            <IconCopy v-else class="size-3.5" />
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-2.5 rounded-[10px] border p-3.5">
            <div class="text-[12.5px] text-muted-foreground">CPU</div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-[28px] font-semibold tracking-tight">{{ cpu.value }}</span>
              <span class="text-[13px] text-muted-foreground">vCPU</span>
              <code class="ml-auto font-mono text-[11.5px] text-muted-foreground/70">{{ template.defaultResources.cpu }}</code>
            </div>
            <div class="h-[5px] overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary" :style="{ width: `${cpu.share}%` }" />
            </div>
          </div>
          <div class="flex flex-col gap-2.5 rounded-[10px] border p-3.5">
            <div class="text-[12.5px] text-muted-foreground">Memory</div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-[28px] font-semibold tracking-tight">{{ memory.value }}</span>
              <span class="text-[13px] text-muted-foreground">{{ memory.unit }}</span>
              <code class="ml-auto font-mono text-[11.5px] text-muted-foreground/70">{{ template.defaultResources.memory }}</code>
            </div>
            <div class="h-[5px] overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary" :style="{ width: `${memory.share}%` }" />
            </div>
          </div>
        </div>
        <div class="text-xs text-muted-foreground/70">
          Bars show share of a large agent ({{ AGENT_REFERENCE_CPU_MILLI / 1000 }} vCPU · {{ AGENT_REFERENCE_MEMORY_MI / 1024 }} GiB).
        </div>
      </section>

      <section class="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5">
        <div class="flex items-center">
          <h2 class="text-[15px] font-semibold">Skills</h2>
          <button type="button" class="ml-auto text-[13px] text-primary hover:underline" @click="$emit('manageSkills')">
            Manage →
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="s in skills"
            :key="s.id"
            class="flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[12.5px]"
          >
            {{ s.title }}
            <code class="font-mono text-[11px] text-muted-foreground/70">{{ s.name }}</code>
          </span>
          <span v-if="!skills.length" class="text-[13px] text-muted-foreground/70">No skills attached yet.</span>
        </div>
        <Separator />
        <div class="flex items-center">
          <h2 class="text-[15px] font-semibold">MCP servers</h2>
          <button type="button" class="ml-auto text-[13px] text-primary hover:underline" @click="$emit('manageMcps')">
            Manage →
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="m in mcps"
            :key="m.id"
            class="flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[12.5px]"
          >
            <span class="size-1.5 rounded-full" :class="m.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'" />
            {{ m.name }}
          </span>
          <span v-if="!mcps.length" class="text-[13px] text-muted-foreground/70">No MCP servers attached yet.</span>
        </div>
      </section>
    </div>

    <div class="flex min-w-0 flex-col gap-4">
      <section class="rounded-[14px] border bg-card px-5 py-1.5">
        <div class="flex justify-between gap-3 border-b py-3 text-[13px]">
          <span class="text-muted-foreground">Template ID</span>
          <code class="truncate font-mono text-[12.5px]">{{ template.id }}</code>
        </div>
        <div class="flex justify-between gap-3 border-b py-3 text-[13px]">
          <span class="text-muted-foreground">Created</span>
          <span>{{ formatDate(template.createdAt) }}</span>
        </div>
        <div class="flex justify-between gap-3 py-3 text-[13px]">
          <span class="text-muted-foreground">Last updated</span>
          <span>{{ formatDate(template.updatedAt) }}</span>
        </div>
      </section>

      <section class="flex flex-col gap-2 rounded-[14px] border bg-card px-5 py-4">
        <h2 class="text-[15px] font-semibold">Agents from this template</h2>
        <NuxtLink
          v-for="a in agents"
          :key="a.id"
          :to="`/agents/${a.id}`"
          class="-mx-2.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/50"
        >
          <span class="size-[7px] shrink-0 rounded-full" :class="TONE[a.status].dot" />
          <span class="truncate font-mono text-[12.5px]">{{ a.name }}</span>
          <span class="ml-auto shrink-0 text-xs capitalize text-muted-foreground/70">
            {{ a.status }}<template v-if="a.lastDeployStartedAt"> · <DateTimeAgoInline :date="a.lastDeployStartedAt" /></template>
          </span>
        </NuxtLink>
        <div v-if="!agents.length" class="text-[13px] text-muted-foreground/70">No agents yet.</div>
      </section>
    </div>
  </div>
</template>
