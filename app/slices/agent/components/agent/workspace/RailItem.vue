<script setup lang="ts">
import { relativeTime } from '#agent/utils/relativeTime';
const props = defineProps<{
  agent: {
    id: string;
    name: string;
    status: string;
    templateId: string;
    updatedAt?: string;
    /** The Ranch admin agent: marked, and first in the rail. */
    isAdmin?: boolean;
    /** Pinned by an Owner/Admin: marked, and ahead of the rest (CLEAN-216). */
    pinned?: boolean;
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

const updatedRelative = computed(() => relativeTime(props.agent.updatedAt));
</script>

<template>
  <button
    type="button"
    class="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-muted/60"
    :class="active && 'bg-muted shadow-[inset_2px_0_0_0_var(--primary)]'"
    :aria-current="active ? 'true' : undefined"
  >
    <span
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-linear-to-br from-[#4a3356] to-[#251b2b] text-xs font-semibold text-foreground shadow-sm transition group-hover:border-primary/30"
      :class="active && 'border-primary/40'"
    >
      {{ initials }}
    </span>

    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class="truncate text-sm font-medium" :title="agent.name">
          {{ agent.name }}
        </span>
        <!-- Labelled on a wrapper with a role, so the mark is announced as
             one image with a name rather than as a bare svg. -->
        <span
          v-if="agent.pinned"
          class="shrink-0 text-primary"
          role="img"
          :title="$t('sheet.pinned')"
          :aria-label="$t('sheet.pinned')"
          data-pinned
        >
          <Icon name="pin" :size="12" />
        </span>
        <span
          v-if="agent.isAdmin"
          class="shrink-0 text-primary"
          role="img"
          :title="$t('rail.admin_agent')"
          :aria-label="$t('rail.admin_agent')"
        >
          <Icon name="shield" :size="13" />
        </span>
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
