<script setup lang="ts">
import type { IChatSession } from '#chat/stores/chat';

const props = defineProps<{ session: IChatSession }>();
const emit = defineEmits<{ updated: [session: IChatSession] }>();

const store = useChatStore();

const summarizing = ref(false);
const insightError = ref<string | null>(null);

async function onSummarize() {
  summarizing.value = true;
  insightError.value = null;
  try {
    const updated = await store.summarize(props.session.id);
    if (updated) emit('updated', updated);
  } catch (err) {
    insightError.value = (err as Error).message;
  } finally {
    summarizing.value = false;
  }
}

const sentimentVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  positive: 'secondary',
  neutral: 'default',
  negative: 'destructive',
  mixed: 'secondary',
};
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 py-3.5">
    <div class="flex items-center justify-between gap-2">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70"
      >
        Summary
      </span>
      <button
        type="button"
        class="rounded-[7px] bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/70 disabled:opacity-50"
        :disabled="summarizing"
        @click="onSummarize"
      >
        {{ summarizing ? 'Summarizing…' : session.summary ? 'Re-summarize' : 'Summarize' }}
      </button>
    </div>

    <div v-if="session.insights" class="flex flex-wrap items-center gap-1.5">
      <Badge
        :variant="sentimentVariant[session.insights.sentiment] ?? 'secondary'"
        class="capitalize"
      >
        {{ session.insights.sentiment }}
      </Badge>
      <Badge variant="outline" class="capitalize">
        {{ session.insights.resolved ? 'resolved' : 'unresolved' }}
      </Badge>
      <Badge variant="outline" class="capitalize">
        {{ session.insights.language }}
      </Badge>
    </div>

    <p v-if="insightError" class="text-xs text-destructive">{{ insightError }}</p>
    <p v-if="session.summary" class="text-[12.5px] leading-relaxed text-muted-foreground">
      {{ session.summary }}
    </p>
    <p v-else class="text-[12.5px] leading-relaxed text-muted-foreground/70">
      No summary yet — click Summarize to generate one.
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
</template>
