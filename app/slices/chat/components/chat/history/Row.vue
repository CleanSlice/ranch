<script setup lang="ts">
import type { IChatSession } from '#chat/stores/chat';
import { useFormat } from '#common/composables/useFormat';

/**
 * One conversation in an agent's history (CLEAN-248). A button, not a link:
 * where it leads is the panel's business, so it only says it was picked.
 */
const props = defineProps<{ session: IChatSession }>();
defineEmits<{ pick: [] }>();

const format = useFormat();

// An explicit title, else the start of the summary, so a row is never blank.
const heading = computed(() => {
  const title = props.session.title?.trim();
  if (title) return title;
  const summary = props.session.summary?.trim();
  if (summary) return summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;
  return null;
});

// Whether the matter was settled is only known for a closed conversation
// that has been assessed; anything else shows no mark at all.
const resolvedKey = computed(() => {
  if (!props.session.archived || !props.session.insights) return null;
  return props.session.insights.resolved ? 'session.resolved' : 'session.unresolved';
});
</script>

<template>
  <button
    type="button"
    class="history-row flex w-full items-start gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    data-history-row
    :data-state="session.archived ? 'closed' : 'running'"
    @click="$emit('pick')"
  >
    <span
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <Icon name="message-square" :size="15" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[13.5px] font-semibold">
        {{ heading ?? $t('session.fallback_title') }}
      </span>
      <span
        v-if="session.preview"
        class="mt-px block truncate text-xs text-muted-foreground"
      >
        {{ session.preview }}
      </span>
      <span
        class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/80"
      >
        <span
          v-if="!session.archived"
          class="rounded-full border border-emerald-500/50 px-1.5 py-px text-[10.5px] text-emerald-600 dark:text-emerald-400"
        >
          {{ $t('history.running') }}
        </span>
        <span v-else class="rounded-full border px-1.5 py-px text-[10.5px] text-muted-foreground">
          {{ $t('session.closed') }}
        </span>
        <span
          v-if="resolvedKey"
          class="rounded-full border px-1.5 py-px text-[10.5px]"
          :class="
            session.insights?.resolved
              ? 'text-muted-foreground'
              : 'border-primary/40 text-primary'
          "
        >
          {{ $t(resolvedKey) }}
        </span>
        <span>
          {{
            $t(
              'session.message_count',
              { count: format.number(session.messageCount) },
              session.messageCount,
            )
          }}
        </span>
      </span>
    </span>
    <time
      class="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground/80"
      :datetime="session.lastMessageAt"
      :title="format.stampTitle(session.lastMessageAt)"
    >
      {{ format.stamp(session.lastMessageAt) }}
    </time>
  </button>
</template>
