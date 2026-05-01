<script setup lang="ts">
const props = defineProps<{
  agent: {
    id: string;
    name: string;
    status: string;
    templateId: string;
    updatedAt?: string;
  };
}>();

// Initials from name — fallback to first 2 chars of id when name missing.
const initials = computed(() => {
  const source = props.agent.name?.trim() || props.agent.id;
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || '?';
});

const statusMeta = computed(() => {
  switch (props.agent.status) {
    case 'running':
      return {
        label: 'Running',
        dot: 'bg-emerald-500',
        pulse: true,
        text: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'deploying':
    case 'pending':
      return {
        label: props.agent.status === 'pending' ? 'Pending' : 'Deploying',
        dot: 'bg-amber-500',
        pulse: true,
        text: 'text-amber-700 dark:text-amber-400',
      };
    case 'failed':
      return {
        label: 'Failed',
        dot: 'bg-rose-500',
        pulse: false,
        text: 'text-rose-700 dark:text-rose-400',
      };
    case 'stopped':
      return {
        label: 'Stopped',
        dot: 'bg-muted-foreground',
        pulse: false,
        text: 'text-muted-foreground',
      };
    default:
      return {
        label: props.agent.status,
        dot: 'bg-muted-foreground',
        pulse: false,
        text: 'text-muted-foreground',
      };
  }
});

const updatedRelative = computed(() => {
  if (!props.agent.updatedAt) return null;
  const ts = Date.parse(props.agent.updatedAt);
  if (Number.isNaN(ts)) return null;
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
});
</script>

<template>
  <NuxtLink
    :to="`/agents/${agent.id}`"
    class="group relative flex flex-col rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
  >
    <div class="flex items-start gap-4">
      <div
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 font-semibold text-primary"
      >
        {{ initials }}
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-base font-semibold">{{ agent.name }}</h3>
        </div>
        <p
          class="mt-0.5 truncate text-xs text-muted-foreground"
          :title="agent.templateId"
        >
          {{ agent.templateId }}
        </p>
      </div>

      <div
        class="flex shrink-0 items-center gap-2 text-xs font-medium"
        :class="statusMeta.text"
      >
        <span class="relative flex h-2 w-2">
          <span
            v-if="statusMeta.pulse"
            class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
            :class="statusMeta.dot"
          />
          <span
            class="relative inline-flex h-2 w-2 rounded-full"
            :class="statusMeta.dot"
          />
        </span>
        {{ statusMeta.label }}
      </div>
    </div>

    <div
      class="mt-5 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground"
    >
      <span class="inline-flex items-center gap-1 truncate">
        <Icon name="message-square" :size="12" class="-mt-0.5" />
        Open chat
        <Icon
          name="arrow-up-right"
          :size="12"
          class="-mt-0.5 -translate-x-0.5 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-80"
        />
      </span>
      <span v-if="updatedRelative" class="shrink-0">
        Updated {{ updatedRelative }}
      </span>
    </div>
  </NuxtLink>
</template>
