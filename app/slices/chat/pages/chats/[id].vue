<script setup lang="ts">
import { panelLocation } from '#agent/utils/panelView';

// The address a conversation had on the old History page (CLEAN-248). The
// conversation is inside its agent now, and which agent that is only the
// record says: so it is asked for, and the person is sent on to it. A closed
// conversation opens for reading; the one going on now is the agent's chat.
const route = useRoute();
const id = route.params.id as string;
const chatStore = useChatStore();

// 'missing': it does not exist, or it is not this person's, or its agent is
// not theirs to reach any more — the server answers all three the same way.
const problem = ref<'missing' | 'failed' | null>(null);

async function resolve() {
  problem.value = null;
  try {
    const found = await chatStore.getMine(id);
    if (!found) {
      problem.value = 'missing';
      return;
    }
    await navigateTo(
      panelLocation(
        found.agentId,
        found.archived ? { kind: 'conversation', chatId: found.id } : { kind: 'chat' },
      ),
      { replace: true },
    );
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    problem.value = status === 404 ? 'missing' : 'failed';
  }
}

onMounted(resolve);
</script>

<template>
  <div class="container mx-auto px-4 py-10">
    <div
      v-if="problem"
      class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
      role="status"
    >
      <template v-if="problem === 'missing'">
        <h2 class="text-base font-semibold">{{ $t('session.not_found_title') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ $t('session.not_found_hint') }}</p>
      </template>
      <template v-else>
        <h2 class="text-base font-semibold">{{ $t('history.load_failed') }}</h2>
        <button
          type="button"
          class="mt-3 rounded-full border px-3.5 py-1.5 text-xs font-medium transition hover:bg-muted"
          @click="resolve"
        >
          {{ $t('history.retry') }}
        </button>
      </template>
      <div class="mt-5">
        <NuxtLink
          to="/agents"
          class="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-95"
        >
          <Icon name="bot" :size="14" />
          {{ $t('nav.agents') }}
        </NuxtLink>
      </div>
    </div>
    <div v-else class="flex justify-center py-16" aria-busy="true">
      <Icon name="loader-2" :size="20" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
