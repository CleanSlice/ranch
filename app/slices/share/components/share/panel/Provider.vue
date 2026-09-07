<script setup lang="ts">
/**
 * Owner-side share panel: the Share button in the agent header and the popover
 * behind it.
 *
 * One component covers the whole owner story (US1 + US3) because every action
 * is the same shape — one call on the share store, which answers with the
 * agent's current link state. The panel therefore never keeps a copy of the
 * link; it renders `shareStore.linkFor(agentId)` and lets the store be the
 * single source of truth (FR-017).
 *
 * There are no popover primitives in `app` (only `Badge` and `Icon`), so this
 * is hand-rolled in the same Tailwind idiom as the header's Restart button and
 * the mobile rail overlay: an absolutely positioned card, closed by Escape or a
 * click outside.
 */
const props = defineProps<{ agentId: string }>();

const shareStore = useShareStore();
// The one sanctioned use of `useI18n()` in a component: the locale itself, for
// date formatting (docs/i18n.md). Copy still goes through the injected `$t`.
const { locale } = useI18n();

const root = ref<HTMLElement | null>(null);

const open = ref(false);
const copied = ref(false);
/** Which destructive action is waiting for its inline confirmation, if any. */
const confirming = ref<'revoke' | 'regenerate' | null>(null);
/** Set once after a successful revoke so the empty state isn't silent. */
const revoked = ref(false);

const link = computed(() => shareStore.linkFor(props.agentId));

/**
 * A link the owner cannot copy is not a link: the store only builds `url` for
 * an active link that still carries its token, so this single flag decides
 * between the two states of the panel.
 */
const isShared = computed(() => {
  const state = link.value;
  return Boolean(state?.active && state.url);
});

const shareUrl = computed(() => link.value?.url ?? '');

/**
 * First read for this agent. Without this the panel would flash "not shared"
 * with a Share button under the user's cursor while the real state is still in
 * flight — on an agent that already has a link (spec US1 scenario 2).
 */
const loadingLink = computed(() => shareStore.pending && !link.value);

/**
 * The read failed and there is nothing to render: claiming "this agent is not
 * shared" here would be a guess, and the Share button under it would mint a
 * link on an agent that may already have one. Offer the retry instead.
 */
const linkUnknown = computed(
  () => !loadingLink.value && !link.value && Boolean(shareStore.error),
);

const sharedSince = computed(() => {
  const iso = link.value?.createdAt;
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(locale.value);
});

// Copy computed in script travels as a key, never as text (docs/i18n.md).
const emptyStateKey = computed(() =>
  revoked.value ? 'share.panel.revoked' : 'share.panel.not_shared',
);
const confirmTextKey = computed(() =>
  confirming.value === 'revoke'
    ? 'share.panel.revoke_confirm'
    : 'share.panel.regenerate_confirm',
);
const confirmActionKey = computed(() =>
  confirming.value === 'revoke'
    ? 'share.panel.revoke_yes'
    : 'share.panel.regenerate_yes',
);

// ------------------------------------------------------------------ clipboard

let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function flashCopied() {
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
    copiedTimer = null;
  }, 1500);
}

function resetCopied() {
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = null;
  copied.value = false;
}

async function onCopy() {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    flashCopied();
  } catch {
    // Clipboard writes are refused in some contexts (insecure origin, denied
    // permission). The URL stays selected-on-focus in the field, which is the
    // fallback the user already has — an error banner would be noise.
  }
}

function selectAll(event: Event) {
  (event.target as HTMLInputElement).select();
}

// --------------------------------------------------------------- open / close

function onDocumentMousedown(event: MouseEvent) {
  // The trigger lives inside `root`, so its own click never closes here — the
  // button's @click toggles instead, which keeps a second click on it closing.
  if (root.value?.contains(event.target as Node)) return;
  close();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

function close() {
  if (!open.value) return;
  open.value = false;
  confirming.value = null;
  document.removeEventListener('mousedown', onDocumentMousedown);
  document.removeEventListener('keydown', onDocumentKeydown);
}

function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  confirming.value = null;
  revoked.value = false;
  resetCopied();
  document.addEventListener('mousedown', onDocumentMousedown);
  document.addEventListener('keydown', onDocumentKeydown);
  // Opening only *reads* the state: reopening the panel must show the existing
  // link, never mint a new one (FR-004). Creating is what Share is for.
  void shareStore.loadLink(props.agentId);
}

// ----------------------------------------------------------------- the actions

async function onShare() {
  revoked.value = false;
  await shareStore.share(props.agentId);
}

/** Same read the open does — offered when that read failed. */
async function onRetry() {
  await shareStore.loadLink(props.agentId);
}

function ask(action: 'revoke' | 'regenerate') {
  confirming.value = action;
}

async function onConfirm() {
  const action = confirming.value;
  if (!action || shareStore.pending) return;
  // Whatever happens next, the URL on the clipboard is about to be stale.
  resetCopied();
  // `confirming` is cleared only after the call, so the confirm row is what
  // carries the spinner — the row it would fall back to is not on screen yet.
  const state =
    action === 'revoke'
      ? await shareStore.revoke(props.agentId)
      : await shareStore.regenerate(props.agentId);
  confirming.value = null;
  if (action === 'revoke') revoked.value = Boolean(state);
}

// The header keeps this component mounted while the user switches agents, so
// the popover has to let go of the agent it was opened for.
watch(() => props.agentId, () => close());

onBeforeUnmount(() => {
  close();
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <!-- Deliberately NOT `relative`: the popover anchors to the header strip
       (which carries `relative`), not to this button. Anchored to the button it
       would start ~115px in from the right on a phone — Restart, the flex gap
       and the header padding — and a 20rem card would run off the left edge. -->
  <div ref="root">
    <!-- Same shape as the Restart button next to it — this is a header action,
         not a call to action. -->
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 transition"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <Icon name="share-2" :size="13" />
      {{ $t('share.panel.share') }}
    </button>

    <div
      v-if="open"
      class="absolute right-4 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border bg-card p-3 shadow-md z-30"
      role="dialog"
      :aria-label="$t('share.panel.title')"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-semibold">{{ $t('share.panel.title') }}</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {{ $t('share.panel.hint') }}
          </p>
        </div>
        <button
          type="button"
          class="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          :aria-label="$t('share.panel.close')"
          @click="close"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>

      <div v-if="loadingLink" class="mt-3 flex justify-center py-3">
        <Icon
          name="loader-2"
          :size="16"
          class="animate-spin text-muted-foreground"
        />
      </div>

      <!-- The read failed: say so and offer it again, rather than guessing. -->
      <div v-else-if="linkUnknown" class="mt-3">
        <p
          class="rounded-md bg-rose-500/10 px-2 py-1.5 text-[11px] leading-snug text-rose-700 dark:text-rose-400"
        >
          {{ $t('share.panel.error') }}
        </p>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition hover:bg-muted disabled:opacity-60"
          :disabled="shareStore.pending"
          @click="onRetry"
        >
          <Icon name="refresh-cw" :size="12" />
          {{ $t('share.panel.retry') }}
        </button>
      </div>

      <!-- Shared: the link, when it started, and what can be done to it. -->
      <template v-else-if="isShared">
        <div
          class="mt-3 flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5"
        >
          <Icon name="link-2" :size="13" class="text-muted-foreground" />
          <input
            :value="shareUrl"
            readonly
            dir="ltr"
            :aria-label="$t('share.panel.title')"
            class="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none"
            @focus="selectAll"
          >
        </div>

        <p v-if="sharedSince" class="mt-1.5 text-[11px] text-muted-foreground">
          {{ $t('share.panel.shared_since', { date: sharedSince }) }}
        </p>

        <div v-if="!confirming" class="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium transition hover:opacity-90 disabled:opacity-60"
            :disabled="shareStore.pending"
            @click="onCopy"
          >
            <Icon :name="copied ? 'check' : 'copy'" :size="12" />
            <template v-if="copied">{{ $t('share.panel.copied') }}</template>
            <template v-else>{{ $t('share.panel.copy') }}</template>
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition hover:bg-muted disabled:opacity-60"
            :disabled="shareStore.pending"
            @click="ask('regenerate')"
          >
            <Icon name="refresh-cw" :size="12" />
            {{ $t('share.panel.regenerate') }}
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-60 dark:text-rose-400"
            :disabled="shareStore.pending"
            @click="ask('revoke')"
          >
            <Icon name="ban" :size="12" />
            {{ $t('share.panel.revoke') }}
          </button>
        </div>

        <!-- Two-step confirm, inline: a native confirm() dialog would drop the
             popover's focus and read as a browser error. -->
        <div v-else class="mt-3 rounded-md border bg-muted/40 p-2">
          <p class="text-[11px] leading-snug">{{ $t(confirmTextKey) }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              :disabled="shareStore.pending"
              @click="onConfirm"
            >
              <Icon
                v-if="shareStore.pending"
                name="loader-2"
                :size="12"
                class="animate-spin"
              />
              {{ $t(confirmActionKey) }}
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition hover:bg-muted disabled:opacity-60"
              :disabled="shareStore.pending"
              @click="confirming = null"
            >
              {{ $t('share.panel.cancel') }}
            </button>
          </div>
        </div>
      </template>

      <!-- Not shared: one action, and one line saying why there is nothing to
           copy. After a revoke that line reports the revoke instead. -->
      <template v-else>
        <p class="mt-3 text-[11px] text-muted-foreground">
          {{ $t(emptyStateKey) }}
        </p>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium transition hover:opacity-90 disabled:opacity-60"
          :disabled="shareStore.pending"
          @click="onShare"
        >
          <Icon
            :name="shareStore.pending ? 'loader-2' : 'share-2'"
            :size="12"
            :class="shareStore.pending ? 'animate-spin' : undefined"
          />
          {{ $t('share.panel.share') }}
        </button>
      </template>

      <!-- `linkUnknown` renders its own copy of this line above, with a retry. -->
      <p
        v-if="shareStore.error && !linkUnknown"
        class="mt-3 rounded-md bg-rose-500/10 px-2 py-1.5 text-[11px] leading-snug text-rose-700 dark:text-rose-400"
      >
        {{ $t('share.panel.error') }}
      </p>
    </div>
  </div>
</template>
