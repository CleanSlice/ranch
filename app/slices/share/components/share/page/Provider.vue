<script setup lang="ts">
/**
 * The whole visitor side of a share link: everything `/share?token=…` renders.
 *
 * Three states and nothing else — `loading`, `invalid`, `ready` — because that
 * is all a visitor can be told without leaking anything about the agent
 * (FR-013): a link either opens a chat or it does not, and an unknown token, a
 * revoked one and a regenerated one are indistinguishable here on purpose.
 *
 * `ready` draws its own slim header (name + status dot) and hands the
 * conversation to `<BridleChatProvider>` with `:show-header="false"` — the same
 * chat the console runs, carrying a descriptor whose `share` credentials become
 * the `X-Share-Token` / `X-Share-Visitor` pair on every request.
 *
 * Nothing from the console layout appears: no `LayoutProvider`, no navigation,
 * no login link (FR-009).
 */
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import type { IBridleConversation } from '#bridle/domain';

const props = defineProps<{ token: string }>();

/** `invalid` is terminal: a token the API refused never becomes valid again. */
type PageStates = 'loading' | 'invalid' | 'ready';

/**
 * The API's own `ShareResolveRequestDto` pattern. Checking it here means a
 * truncated or hand-typed link shows the invalid state immediately instead of
 * spending a request to be told 400.
 */
const TOKEN_PATTERN = /^sl_[A-Za-z0-9_-]{43}$/;

/** SC-003: a revoked link stops working for a visitor within 30 seconds. */
const RE_RESOLVE_MS = 30_000;

/** Set per request by the bridle gateway; the marker for "this call is ours". */
const SHARE_TOKEN_HEADER = 'X-Share-Token';

const shareStore = useShareStore();
/** Stable per browser — what makes this visitor's conversation their own. */
const visitorId = useShareVisitorId();

const state = ref<PageStates>('loading');
/**
 * Sticky. A page that was once `ready` and turns invalid was revoked while the
 * visitor watched (US3 scenario 3); one that never resolved is just a bad link.
 * The two deserve different wording.
 */
const wasReady = ref(false);
/** The last resolve never reached the API — shown only while the first load is open. */
const reconnecting = ref(false);

/**
 * The token a resolve is currently in flight for, or `null` when idle.
 *
 * A plain boolean would keep a background poll from stacking on itself but
 * would also swallow the *new* token's first resolve while the old one is
 * still open — the page would sit on `loading` until the next 30s tick.
 * Latching on the token instead lets a new link overtake an old request while
 * still collapsing repeat polls for the same one.
 */
let inFlightToken: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** Id of the response interceptor watching chat calls for a 403. */
let forbiddenInterceptor: number | null = null;

const resolved = computed(() => shareStore.resolved);
const agentId = computed(() => resolved.value?.agentId ?? '');
const agentName = computed(() => resolved.value?.agentName ?? '');
/** FR-015: anything but `running` means messages may not land right now. */
const isRunning = computed(() => resolved.value?.agentStatus === 'running');

const initials = computed(() => {
  const parts = agentName.value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
});

/**
 * The status dot only — deliberately without the console's status *word*. A
 * visitor has no use for "Deploying" or "Failed", and the banner below already
 * says the one thing that matters to them in plain language.
 */
const statusMeta = computed(() => {
  switch (resolved.value?.agentStatus) {
    case 'running':
      return { dot: 'bg-emerald-500', pulse: true };
    case 'deploying':
    case 'pending':
      return { dot: 'bg-amber-500', pulse: true };
    case 'failed':
      return { dot: 'bg-rose-500', pulse: false };
    default:
      return { dot: 'bg-muted-foreground', pulse: false };
  }
});

/**
 * Keyed by agent *and* visitor, never by token: a regenerated link must not
 * cost the visitor their history, and the owner's console conversation with
 * the same agent (`key === agentId`) has to stay separate (FR-011).
 */
const conversation = computed<IBridleConversation>(() => ({
  key: `share:${agentId.value}:${visitorId}`,
  agentId: agentId.value,
  share: { token: props.token, visitorId },
}));

// Copy decided in script travels as a key, never as text (docs/i18n.md).
const invalidTitleKey = computed(() =>
  wasReady.value ? 'share.page.revoked_title' : 'share.page.invalid_title',
);

// ------------------------------------------------------------------ resolving

/**
 * A function rather than an inline comparison: TypeScript keeps the narrowing
 * from the first check alive across the `await` in `runResolve`, which makes
 * the second one look impossible.
 */
function isInvalid(): boolean {
  return state.value === 'invalid';
}

function markInvalid() {
  state.value = 'invalid';
  reconnecting.value = false;
  // The token is dead for good; polling it would only make noise.
  stopPolling();
}

async function runResolve() {
  if (isInvalid()) return;

  // Pinned before the await. `props.token` can change mid-flight (the query
  // updates and the watcher below resets the page), and an answer about the
  // *old* link must not decide anything about the new one — least of all mark
  // it `ready` with the previous agent's name still in the store.
  const token = props.token;
  if (inFlightToken === token) return;

  // Empty or malformed: invalid without a request.
  if (!TOKEN_PATTERN.test(token)) {
    markInvalid();
    return;
  }

  inFlightToken = token;
  try {
    const outcome = await shareStore.resolve(token);
    // A chat call may have seen a 403 while this was in flight — that verdict
    // is final and must not be undone by an answer that started earlier.
    if (isInvalid()) return;
    // Stale answer: the token moved on while this was open. Whatever it says
    // is about a link the visitor is no longer looking at.
    if (token !== props.token) return;

    if (outcome === 'resolved') {
      reconnecting.value = false;
      wasReady.value = true;
      state.value = 'ready';
    } else if (outcome === 'invalid') {
      markInvalid();
    } else {
      // Nothing was learned about the link — keep what is on screen. A visitor
      // mid-conversation notices nothing; a first load says it is retrying.
      reconnecting.value = true;
    }
  } finally {
    // Only release the latch if it is still ours: a newer token has already
    // claimed it, and clearing it here would let a poll double up.
    if (inFlightToken === token) inFlightToken = null;
  }
}

// ------------------------------------------------------------------- polling
//
// The store's `pending` is a single shared flag, so it is deliberately not
// rendered here: a background poll must never put a spinner over a working
// chat. `state` is the only thing the template reads.

function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startPolling() {
  if (timer || isInvalid()) return;
  // A hidden tab polls nothing; coming back re-resolves immediately below.
  if (document.visibilityState !== 'visible') return;
  timer = setInterval(() => void runResolve(), RE_RESOLVE_MS);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void runResolve();
    startPolling();
  } else {
    stopPolling();
  }
}

// --------------------------------------------------------- revocation mid-chat
//
// A revoked link answers 403 on the chat endpoints. The bridle store cannot
// report that — the generated client returns the axios error as a normal
// result, so a 403 send would surface as an empty reply — so the status is read
// where it still exists: on the axios response, before anything swallows it.

/**
 * Was this request one of ours? A 403 on any other call (a console request from
 * the same tab, say) says nothing about the link.
 */
function carriesShareToken(config: unknown): boolean {
  const headers = (config as { headers?: unknown } | null | undefined)?.headers;
  if (!headers || typeof headers !== 'object') return false;
  // Axios normalizes request headers into an `AxiosHeaders`, which looks up
  // case-insensitively; a plain object is read directly.
  const get = (headers as { get?: (name: string) => unknown }).get;
  if (typeof get === 'function') {
    return get.call(headers, SHARE_TOKEN_HEADER) === props.token;
  }
  return Object.entries(headers as Record<string, unknown>).some(
    ([name, value]) =>
      name.toLowerCase() === SHARE_TOKEN_HEADER.toLowerCase() &&
      value === props.token,
  );
}

function watchForbidden() {
  forbiddenInterceptor = apiClient.instance.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      const status = (error as { response?: { status?: number } } | null)
        ?.response?.status;
      const config = (error as { config?: unknown } | null)?.config;
      if (status === 403 && carriesShareToken(config)) markInvalid();
      // Never swallowed: the chat still has to see its own failure.
      return Promise.reject(error);
    },
  );
}

function unwatchForbidden() {
  if (forbiddenInterceptor === null) return;
  apiClient.instance.interceptors.response.eject(forbiddenInterceptor);
  forbiddenInterceptor = null;
}

// The chat itself talks over the hub socket, which re-checks the link on every
// message and drops the socket with a share code when it is dead. The bridle
// store records that verdict per conversation; it is as final as a 403 here.
const bridleStore = useBridleStore();
watch(
  () => bridleStore.isShareRevoked(conversation.value.key),
  (revoked) => {
    if (revoked) markInvalid();
  },
);

// ------------------------------------------------------------------ lifecycle

// Same page, new link: start over rather than showing the old agent.
watch(
  () => props.token,
  () => {
    wasReady.value = false;
    reconnecting.value = false;
    state.value = 'loading';
    void runResolve();
    startPolling();
  },
);

onMounted(() => {
  watchForbidden();
  document.addEventListener('visibilitychange', onVisibilityChange);
  void runResolve();
  startPolling();
});

onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  unwatchForbidden();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Opening: one line, no chrome. The agent's name is not known yet and
         must not be guessed from anywhere. -->
    <div
      v-if="state === 'loading'"
      class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <Icon name="loader-2" :size="20" class="animate-spin text-muted-foreground" />
      <p class="text-sm text-muted-foreground">{{ $t('share.page.loading') }}</p>
      <p v-if="reconnecting" class="text-xs text-muted-foreground/70">
        {{ $t('share.page.reconnecting') }}
      </p>
    </div>

    <!-- Dead link. Says nothing about the agent, and offers no way into the
         console — there is nothing here for a visitor to log into. -->
    <div
      v-else-if="state === 'invalid'"
      class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <div
        class="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon name="link-2-off" :size="20" />
      </div>
      <h1 class="text-sm font-semibold">{{ $t(invalidTitleKey) }}</h1>
      <p class="max-w-xs text-xs leading-snug text-muted-foreground">
        {{ $t('share.page.invalid_hint') }}
      </p>
    </div>

    <template v-else>
      <header class="shrink-0 border-b bg-card">
        <div class="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary"
          >
            {{ initials }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h1 class="truncate text-sm font-semibold">{{ agentName }}</h1>
              <!-- Decorative: the banner below carries the meaning in words. -->
              <span class="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                <span
                  v-if="statusMeta.pulse"
                  class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
                  :class="statusMeta.dot"
                />
                <span
                  class="relative inline-flex h-1.5 w-1.5 rounded-full"
                  :class="statusMeta.dot"
                />
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{ $t('share.page.powered_by') }}
            </p>
          </div>
        </div>
      </header>

      <!-- FR-015: the composer stays live — the agent may be back by the time
           the message is sent, and the poll clears this on its own. -->
      <div v-if="!isRunning" class="shrink-0 border-b bg-amber-500/10">
        <p
          class="mx-auto w-full max-w-3xl px-4 py-2 text-xs leading-snug text-amber-700 dark:text-amber-400"
        >
          {{ $t('share.page.unavailable') }}
        </p>
      </div>

      <!-- Keyed so a different agent or visitor remounts the chat instead of
           having its descriptor swapped underneath it. -->
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <BridleChatProvider
          :key="conversation.key"
          :agent-id="agentId"
          :conversation="conversation"
          :title="agentName"
          :show-header="false"
        />
      </div>
    </template>
  </div>
</template>
