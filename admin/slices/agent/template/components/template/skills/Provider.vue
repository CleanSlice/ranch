<script setup lang="ts">
import { IconSearch } from '@tabler/icons-vue';
import TemplateItemToggle from '../item/Toggle.vue';

/**
 * The Skills tab (CLEAN-130): every skill on the Ranch as a card with a
 * switch. Toggling edits the draft the parent holds (`v-model:selected`);
 * the parent's "Unsaved changes" bar writes it, so nothing is saved from
 * here.
 */
const selected = defineModel<string[]>('selected', { required: true });

const skillStore = useSkillStore();

const { pending } = useAsyncData('admin-template-skills-list', () => skillStore.fetchAll(), {
  lazy: true,
});

type Segment = 'all' | 'on' | 'off';
const segment = ref<Segment>('all');
const filter = ref('');

const selectedSet = computed(() => new Set(selected.value));

const counts = computed(() => ({
  all: skillStore.items.length,
  on: skillStore.items.filter((s) => selectedSet.value.has(s.id)).length,
  off: skillStore.items.filter((s) => !selectedSet.value.has(s.id)).length,
}));

const segments: { key: Segment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'Attached' },
  { key: 'off', label: 'Available' },
];

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return skillStore.items.filter((s) => {
    const on = selectedSet.value.has(s.id);
    if (segment.value === 'on' && !on) return false;
    if (segment.value === 'off' && on) return false;
    if (!q) return true;
    return `${s.title} ${s.name} ${s.description ?? ''}`.toLowerCase().includes(q);
  });
});

function toggle(id: string) {
  selected.value = selectedSet.value.has(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <div class="flex flex-wrap items-center gap-2.5">
      <div class="relative min-w-60 max-w-md flex-1">
        <IconSearch class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="filter" placeholder="Filter skills" class="pl-9" />
      </div>
      <div class="flex gap-1 rounded-[9px] bg-muted p-[3px]" role="radiogroup" aria-label="Show">
        <button
          v-for="s in segments"
          :key="s.key"
          type="button"
          role="radio"
          :aria-checked="segment === s.key"
          class="h-[30px] rounded-md px-[11px] text-[12.5px] font-medium transition-colors"
          :class="segment === s.key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
          @click="segment = s.key"
        >
          {{ s.label }} {{ counts[s.key] }}
        </button>
      </div>
      <span class="ml-auto text-[13px] text-muted-foreground">
        Content lives in <NuxtLink to="/skills" class="text-primary hover:underline">Skills</NuxtLink>
      </span>
    </div>

    <div v-if="pending && !skillStore.items.length" class="grid gap-2.5 md:grid-cols-2">
      <Skeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" />
    </div>

    <div
      v-else-if="!skillStore.items.length"
      class="rounded-[14px] border border-dashed p-10 text-sm text-muted-foreground"
    >
      No skills yet. Create or import one in
      <NuxtLink to="/skills" class="text-primary hover:underline">Skills</NuxtLink>.
    </div>

    <div
      v-else-if="!visible.length"
      class="rounded-[14px] border border-dashed p-10 text-sm text-muted-foreground"
    >
      No skills match.
    </div>

    <div v-else class="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
      <button
        v-for="s in visible"
        :key="s.id"
        type="button"
        role="switch"
        :aria-checked="selectedSet.has(s.id)"
        class="flex gap-3.5 rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="selectedSet.has(s.id) && 'border-primary/40 ring-[3px] ring-primary/10'"
        @click="toggle(s.id)"
      >
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex min-w-0 items-baseline gap-2">
            <span class="text-sm font-semibold">{{ s.title }}</span>
            <code class="truncate font-mono text-[11.5px] text-muted-foreground/70">{{ s.name }}</code>
          </span>
          <span class="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {{ s.description || 'No description.' }}
          </span>
        </span>
        <TemplateItemToggle :on="selectedSet.has(s.id)" />
      </button>
    </div>
  </div>
</template>
