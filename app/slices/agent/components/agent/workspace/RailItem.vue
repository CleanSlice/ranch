<script setup lang="ts">
const props = defineProps<{
  agent: {
    id: string;
    name: string;
    status: string;
    templateId: string;
    updatedAt?: string;
  };
  active: boolean;
}>();

// Initials from name — fallback to the id when the name is missing.
const initials = computed(() => {
  const source = props.agent.name?.trim() || props.agent.id;
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') || '?'
  );
});

// labelKey is an i18n key; `label` carries the raw status for the default
// branch, where the runtime reported something we have no wording for.
const statusMeta = computed(() => {
  switch (props.agent.status) {
    case 'running':
      return {
        labelKey: 'status.running',
        label: props.agent.status,
        dot: 'bg-emerald-500',
        pulse: true,
        text: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'deploying':
    case 'pending':
      return {
        labelKey:
          props.agent.status === 'pending'
            ? 'status.pending'
            : 'status.deploying',
        label: props.agent.status,
        dot: 'bg-amber-500',
        pulse: true,
        text: 'text-amber-700 dark:text-amber-400',
      };
    case 'failed':
      return {
        labelKey: 'status.failed',
        label: props.agent.status,
        dot: 'bg-rose-500',
        pulse: false,
        text: 'text-rose-700 dark:text-rose-400',
      };
    case 'stopped':
      return {
        labelKey: 'status.stopped',
        label: props.agent.status,
        dot: 'bg-muted-foreground',
        pulse: false,
        text: 'text-muted-foreground',
      };
    default:
      return {
        labelKey: null,
        label: props.agent.status,
        dot: 'bg-muted-foreground',
        pulse: false,
        text: 'text-muted-foreground',
      };
  }
});

// Returns the bucket and its number; the template turns that into words. The
// unit suffix is part of the message ("{count}m ago"), so a language that
// writes it differently — or reorders it — only edits the locale file.
const updatedRelative = computed<{ key: string; count: number } | null>(() => {
  if (!props.agent.updatedAt) return null;
  const ts = Date.parse(props.agent.updatedAt);
  if (Number.isNaN(ts)) return null;
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return { key: 'relative_time.just_now', count: 0 };
  if (diff < hour)
    return { key: 'relative_time.minutes', count: Math.floor(diff / minute) };
  if (diff < day)
    return { key: 'relative_time.hours', count: Math.floor(diff / hour) };
  return { key: 'relative_time.days', count: Math.floor(diff / day) };
});
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted"
    :class="active && 'bg-muted'"
    :aria-current="active ? 'true' : undefined"
  >
    <span
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
    >
      {{ initials }}
    </span>

    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium" :title="agent.name">
        {{ agent.name }}
      </span>
      <span class="mt-0.5 flex items-center gap-1.5 text-xs">
        <span class="relative flex h-1.5 w-1.5">
          <span
            v-if="statusMeta.pulse"
            class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            :class="statusMeta.dot"
          />
          <span
            class="relative inline-flex h-1.5 w-1.5 rounded-full"
            :class="statusMeta.dot"
          />
        </span>
        <span :class="statusMeta.text">
          {{ statusMeta.labelKey ? $t(statusMeta.labelKey) : statusMeta.label }}
        </span>
        <template v-if="updatedRelative">
          <span class="text-muted-foreground/60">·</span>
          <span class="truncate text-muted-foreground">
            {{ $t(updatedRelative.key, { count: updatedRelative.count }) }}
          </span>
        </template>
      </span>
    </span>
  </button>
</template>
