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

const who = computed(
  () => props.session.title || props.session.externalUserId || '—',
);
</script>

<template>
  <div class="rounded-md border bg-card p-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-lg font-semibold">{{ who }}</span>
      <Badge variant="secondary" class="capitalize">{{ session.channel }}</Badge>
      <Badge v-if="session.archived" variant="outline">archived</Badge>
    </div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{{ session.messageCount }} messages · {{ session.userMessageCount }} from user</span>
      <span>Last activity {{ session.lastMessageAt ? formatDateTime(session.lastMessageAt) : '—' }}</span>
      <span class="font-mono">{{ session.sessionKey }}</span>
    </div>
    <!-- LLM summary + insights -->
    <div class="mt-3 rounded bg-muted/40 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">Summary &amp; insights</span>
          <!-- sentiment / resolved / language sit by the header, apart from topics -->
          <template v-if="session.insights">
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
          </template>
        </div>
        <Button size="sm" variant="outline" :disabled="summarizing" @click="onSummarize">
          {{ summarizing ? 'Summarizing…' : session.summary ? 'Re-summarize' : 'Summarize' }}
        </Button>
      </div>
      <p v-if="insightError" class="mt-2 text-sm text-destructive">
        {{ insightError }}
      </p>
      <p v-if="session.summary" class="mt-2 text-sm text-muted-foreground">
        {{ session.summary }}
      </p>
      <p v-else class="mt-2 text-sm text-muted-foreground">
        No summary yet — click Summarize to generate one.
      </p>
      <!-- Topic tags only -->
      <div
        v-if="session.insights?.topics?.length"
        class="mt-2 flex flex-wrap items-center gap-1.5"
      >
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
  </div>
</template>
