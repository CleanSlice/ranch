<script setup lang="ts">
import { BridleSourceKinds, type IBridleSource } from '#bridle/domain';

/**
 * The list under an answer: what it drew on (CLEAN-138). One entry per
 * citation number; the chips in the text point here. Hidden and shown per
 * message, and only here — the chips stay whatever the list does.
 *
 * A web source opens its page. A knowledge source opens its document only
 * when the API said it may (`canOpen`), and only knowledge sources can be
 * liked or disliked: a web page is someone else's, nobody here can act on
 * the verdict. No bookmarks (FR-028).
 *
 * TWIN: admin/slices/bridle/components/bridle/Sources.vue draws the same list
 * in the admin console, in English.
 */
const props = defineProps<{
  sources: IBridleSource[];
  messageId: string;
}>();
const emit = defineEmits<{
  /** A knowledge document the reader may open. */
  open: [n: number];
  /** `null` withdraws the reader's verdict. */
  rate: [n: number, rating: 1 | -1 | null];
}>();

const hidden = ref(false);
const activeN = ref<number | null>(null);
let activeTimer: ReturnType<typeof setTimeout> | null = null;

/** Several bases in one list: say which one each document belongs to. */
const manyBases = computed(
  () =>
    new Set(
      props.sources
        .filter((s) => s.kind === BridleSourceKinds.Knowledge)
        .map((s) => s.knowledgeName ?? ''),
    ).size > 1,
);

function entryId(n: number) {
  return `src-${props.messageId}-${n}`;
}

/** A chip was activated: show the list if hidden, bring the entry into view, mark it briefly. */
function reveal(n: number) {
  hidden.value = false;
  nextTick(() => {
    document.getElementById(entryId(n))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    activeN.value = n;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(() => (activeN.value = null), 1500);
  });
}

/** Same verdict again withdraws it; the other one flips it. */
function onRate(source: IBridleSource, rating: 1 | -1) {
  emit('rate', source.n, source.myRating === rating ? null : rating);
}

onBeforeUnmount(() => {
  if (activeTimer) clearTimeout(activeTimer);
});

defineExpose({ reveal });
</script>

<template>
  <div class="w-full px-1 text-xs" :data-sources-for="messageId">
    <button
      type="button"
      class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      :aria-expanded="!hidden"
      :aria-controls="`${entryId(0)}-list`"
      @click="hidden = !hidden"
    >
      <Icon :name="hidden ? 'eye' : 'eye-off'" :size="12" />
      {{ $t(hidden ? 'chat.sources_show' : 'chat.sources_hide') }}
    </button>

    <ol
      v-show="!hidden"
      :id="`${entryId(0)}-list`"
      class="mt-1 flex flex-col gap-1"
      :aria-label="$t('chat.sources_title')"
    >
      <li
        v-for="source in sources"
        :id="entryId(source.n)"
        :key="source.n"
        class="flex min-w-0 items-start gap-1.5 rounded px-1 py-0.5 transition-colors"
        :class="activeN === source.n && 'bg-primary/10'"
        :data-source-kind="source.kind"
      >
        <span class="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{{ source.n }}.</span>
        <Icon
          :name="source.kind === BridleSourceKinds.Web ? 'globe' : 'book-open'"
          :size="12"
          class="mt-0.5 shrink-0 text-muted-foreground"
          :title="$t(source.kind === BridleSourceKinds.Web ? 'chat.source_kind_web' : 'chat.source_kind_knowledge')"
        />
        <span class="min-w-0 flex-1 break-words">
          <!-- A web source opens its page; the title is the page's own. -->
          <a
            v-if="source.kind === BridleSourceKinds.Web && source.url"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline-offset-2 hover:underline"
            :title="$t('chat.source_open', { name: source.name })"
          >{{ source.name }}</a>
          <!-- A knowledge document opens through the citation, when the base allows it. -->
          <button
            v-else-if="source.kind === BridleSourceKinds.Knowledge && source.canOpen"
            type="button"
            class="text-left text-primary underline-offset-2 hover:underline"
            :title="$t('chat.source_open', { name: source.name })"
            @click="emit('open', source.n)"
          >{{ source.name }}</button>
          <span
            v-else
            :title="source.kind === BridleSourceKinds.Knowledge ? $t('chat.source_locked') : undefined"
          >{{ source.name }}</span>
          <span
            v-if="source.kind === BridleSourceKinds.Knowledge && manyBases && source.knowledgeName"
            class="text-muted-foreground"
          > · {{ source.knowledgeName }}</span>
        </span>

        <!-- Only our own sources can be rated: the verdict lands on the document. -->
        <span
          v-if="source.kind === BridleSourceKinds.Knowledge"
          class="flex shrink-0 items-center gap-0.5"
        >
          <button
            type="button"
            :aria-label="$t('chat.source_helpful')"
            :aria-pressed="source.myRating === 1"
            class="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
            :class="source.myRating === 1 && 'text-emerald-600'"
            @click="onRate(source, 1)"
          >
            <Icon name="thumbs-up" :size="12" />
          </button>
          <button
            type="button"
            :aria-label="$t('chat.source_not_helpful')"
            :aria-pressed="source.myRating === -1"
            class="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
            :class="source.myRating === -1 && 'text-rose-600'"
            @click="onRate(source, -1)"
          >
            <Icon name="thumbs-down" :size="12" />
          </button>
        </span>
      </li>
    </ol>
  </div>
</template>
