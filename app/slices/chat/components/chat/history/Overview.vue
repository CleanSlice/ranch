<script setup lang="ts">
import type { ChatExportFormat, IChatSession } from '#chat/stores/chat';
import type { INavMapItem } from '#chat/utils/transcript';
import { useFormat } from '#common/composables/useFormat';

/**
 * A closed conversation at a glance (CLEAN-248): how long it was and when,
 * its summary and what was read out of it, the way to any message, and the
 * export. The side block of the old conversation page, whole; where it
 * stands — beside the messages or over them — is the reading view's choice.
 */
const props = defineProps<{
  session: IChatSession;
  navItems: INavMapItem[];
  /**
   * The messages are still on their way, so there is nothing to navigate
   * yet. Navigation keeps its place as a placeholder rather than being
   * absent and then pushing Export down when it arrives (CLEAN-253).
   */
  navPending?: boolean;
}>();
defineEmits<{
  jump: [messageId: string];
  export: [format: ChatExportFormat];
}>();

const format = useFormat();

// The outline of Navigation while the messages load: one line per message
// the conversation is known to have, up to the nine that fill the real
// block's height (it scrolls beyond 16 rem). Sized this way the outline is as
// tall as what replaces it, and Export below does not move.
const NAV_PLACEHOLDER_MAX = 9;
const NAV_PLACEHOLDER_WIDTHS = ['w-4/5', 'w-3/5', 'w-11/12', 'w-2/3', 'w-3/4'];
const navPlaceholder = computed(() => {
  const rows = Math.min(NAV_PLACEHOLDER_MAX, Math.max(1, props.session.messageCount));
  return Array.from(
    { length: rows },
    (_, i) => NAV_PLACEHOLDER_WIDTHS[i % NAV_PLACEHOLDER_WIDTHS.length]!,
  );
});

const EXPORT_FORMATS: ChatExportFormat[] = ['json', 'markdown', 'csv'];

// A sentiment the console knows is shown through its key; the mapper has
// already folded anything else into 'neutral'.
const SENTIMENT_KEYS: Record<string, string> = {
  positive: 'session.sentiment_positive',
  neutral: 'session.sentiment_neutral',
  negative: 'session.sentiment_negative',
  mixed: 'session.sentiment_mixed',
};
const sentimentKey = (sentiment: string): string | null => SENTIMENT_KEYS[sentiment] ?? null;

const sentimentVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  positive: 'secondary',
  neutral: 'default',
  negative: 'destructive',
  mixed: 'secondary',
};
</script>

<template>
  <div class="flex flex-col gap-3.5" data-overview>
    <!-- Counts -->
    <div class="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3.5">
      <div class="flex items-center justify-between gap-3 text-[12.5px]">
        <span class="text-muted-foreground/70">{{ $t('session.meta_messages') }}</span>
        <span class="font-medium">{{ format.number(session.messageCount) }}</span>
      </div>
      <div class="flex items-center justify-between gap-3 text-[12.5px]">
        <span class="text-muted-foreground/70">{{ $t('session.meta_activity') }}</span>
        <span class="text-right font-medium">
          {{ format.dateTime(session.lastMessageAt) || '—' }}
        </span>
      </div>
    </div>

    <!-- Summary & insights (read-only) -->
    <div class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 py-3.5">
      <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {{ $t('session.insights_title') }}
      </span>
      <div v-if="session.insights" class="flex flex-wrap items-center gap-1.5">
        <Badge
          :variant="sentimentVariant[session.insights.sentiment] ?? 'secondary'"
          class="capitalize"
        >
          {{
            sentimentKey(session.insights.sentiment)
              ? $t(sentimentKey(session.insights.sentiment)!)
              : session.insights.sentiment
          }}
        </Badge>
        <Badge variant="outline" class="capitalize">
          {{ $t(session.insights.resolved ? 'session.resolved' : 'session.unresolved') }}
        </Badge>
        <Badge variant="outline" class="capitalize">
          <!-- An ISO 639-1 code, or 'unknown' when none was detected. -->
          {{
            session.insights.language === 'unknown'
              ? $t('value.unknown')
              : format.languageName(session.insights.language)
          }}
        </Badge>
      </div>
      <p v-if="session.summary" class="text-[12.5px] leading-relaxed text-muted-foreground">
        {{ session.summary }}
      </p>
      <p v-else class="text-[12.5px] leading-relaxed text-muted-foreground/70">
        {{ $t('session.no_summary') }}
      </p>
      <div v-if="session.insights?.topics?.length" class="flex flex-wrap items-center gap-1.5">
        <Badge
          v-for="topic in session.insights.topics"
          :key="topic"
          variant="outline"
          class="capitalize"
        >
          {{ topic }}
        </Badge>
      </div>
    </div>

    <!-- Navigation, or its outline while the messages load: the same frame
         and heading as the real block. -->
    <div
      v-if="navPending && !navItems.length"
      class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 pb-2 pt-3.5"
      role="status"
      aria-busy="true"
      data-overview-nav="loading"
    >
      <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {{ $t('session.navigation') }}
      </span>
      <span class="sr-only">{{ $t('session.loading') }}</span>
      <!-- Rows of the real list's height (padding and one line of text),
           with no gap between them, as there. -->
      <div class="flex max-h-64 flex-col overflow-hidden" aria-hidden="true">
        <div
          v-for="(width, i) in navPlaceholder"
          :key="i"
          class="flex h-7 shrink-0 items-center gap-2"
        >
          <span class="size-[7px] shrink-0 rounded-full bg-muted" />
          <span class="h-3 animate-pulse rounded bg-muted" :class="width" />
        </div>
      </div>
    </div>
    <ChatHistoryNavMap v-else :items="navItems" @jump="(id: string) => $emit('jump', id)" />

    <!-- Export -->
    <div class="flex items-center gap-1.5 px-1">
      <span class="mr-1 text-xs text-muted-foreground">{{ $t('session.export') }}</span>
      <button
        v-for="f in EXPORT_FORMATS"
        :key="f"
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        @click="$emit('export', f)"
      >
        {{ f === 'markdown' ? 'MD' : f.toUpperCase() }}
      </button>
    </div>
  </div>
</template>
