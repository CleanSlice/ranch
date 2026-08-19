<script setup lang="ts">
import type { IChatSession } from '#chat/stores/chat';

const props = defineProps<{ session: IChatSession }>();

// Prefer an explicit title; else lean on the LLM summary / last preview so the
// card is never blank.
const heading = computed(() => {
  const t = props.session.title?.trim();
  if (t) return t;
  const s = props.session.summary?.trim();
  if (s) return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  return null;
});

const relative = computed<{ key: string; count: number } | null>(() => {
  const ts = Date.parse(props.session.lastMessageAt);
  if (Number.isNaN(ts)) return null;
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return { key: 'relative_time.just_now', count: 0 };
  if (diff < hour) return { key: 'relative_time.minutes', count: Math.floor(diff / minute) };
  if (diff < day) return { key: 'relative_time.hours', count: Math.floor(diff / hour) };
  return { key: 'relative_time.days', count: Math.floor(diff / day) };
});
</script>

<template>
  <NuxtLink
    :to="`/chats/${session.id}`"
    class="group flex flex-col rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
  >
    <div class="flex items-start gap-3">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-primary"
      >
        <Icon name="message-square" :size="18" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-base font-semibold">
          {{ heading ?? $t('session.fallback_title') }}
        </h3>
        <p
          v-if="session.preview"
          class="mt-0.5 truncate text-xs text-muted-foreground"
        >
          {{ session.preview }}
        </p>
      </div>
    </div>

    <div
      class="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground"
    >
      <span class="inline-flex items-center gap-1">
        <Icon name="messages-square" :size="12" class="-mt-0.5" />
        {{
          $t(
            'session.message_count',
            { count: session.messageCount },
            session.messageCount,
          )
        }}
      </span>
      <span v-if="relative" class="shrink-0">
        {{ $t(relative.key, { count: relative.count }) }}
      </span>
    </div>
  </NuxtLink>
</template>
