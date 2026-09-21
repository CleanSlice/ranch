<script setup lang="ts">
/**
 * The Share button in the agent header and the popover behind it (CLEAN-104).
 *
 * This is the app console's share panel, offered a second time where operators
 * already manage the agent. It drives the same endpoints, so there is one link
 * per agent no matter which console touched it last — and that link opens the
 * app's `/share` page, never anything in admin.
 *
 * The panel keeps no copy of the link; it renders `shareStore.linkFor(agentId)`
 * (docs/state.md).
 */
import {
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui';
import {
  IconBan,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconLoader2,
  IconRefresh,
  IconShare2,
  IconX,
} from '@tabler/icons-vue';

const props = defineProps<{ agentId: string }>();

const shareStore = useShareStore();

const open = ref(false);
const copied = ref(false);
/** Which destructive action is waiting for its inline confirmation, if any. */
const confirming = ref<'revoke' | 'regenerate' | null>(null);
/** Set once after a successful revoke so the empty state isn't silent. */
const revoked = ref(false);

const link = computed(() => shareStore.linkFor(props.agentId));

const isShared = computed(() => Boolean(link.value?.active));

/**
 * Shared, but admin was never told where the app lives, so there is no URL to
 * hand out. Revoke and Regenerate still work — they need no URL.
 */
const appUrlMissing = computed(() => isShared.value && !link.value?.url);

const shareUrl = computed(() => link.value?.url ?? '');

/**
 * First read for this agent. Without this the panel would flash "not shared"
 * with a Share button under the cursor while the real state is still in
 * flight — on an agent that already has a link.
 */
const loadingLink = computed(() => shareStore.pending && !link.value);

/**
 * The read failed and there is nothing to render: claiming "not shared" here
 * would be a guess. Offer the retry instead.
 */
const linkUnknown = computed(
  () => !loadingLink.value && !link.value && Boolean(shareStore.error),
);

const sharedSince = computed(() => {
  const iso = link.value?.createdAt;
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
});

// ------------------------------------------------------------------ clipboard

let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function resetCopied() {
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = null;
  copied.value = false;
}

async function onCopy() {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    resetCopied();
    copied.value = true;
    copiedTimer = setTimeout(resetCopied, 1500);
  } catch {
    // Clipboard writes are refused in some contexts (insecure origin, denied
    // permission). The URL selects itself on focus, which is the fallback the
    // operator already has — an error banner would be noise.
  }
}

function selectAll(event: Event) {
  (event.target as HTMLInputElement).select();
}

// --------------------------------------------------------------- open / close

watch(open, (isOpen) => {
  confirming.value = null;
  if (!isOpen) return;
  revoked.value = false;
  resetCopied();
  // Opening only *reads* the state: reopening the panel must show the existing
  // link, never mint a new one. Creating is what Share is for.
  void shareStore.loadLink(props.agentId);
});

// ----------------------------------------------------------------- the actions

async function onShare() {
  revoked.value = false;
  await shareStore.share(props.agentId);
}

async function onConfirm() {
  const action = confirming.value;
  if (!action || shareStore.pending) return;
  // Whatever happens next, the URL on the clipboard is about to be stale.
  resetCopied();
  // `confirming` is cleared only after the call, so the confirm row is what
  // carries the spinner.
  const state =
    action === 'revoke'
      ? await shareStore.revoke(props.agentId)
      : await shareStore.regenerate(props.agentId);
  confirming.value = null;
  if (action === 'revoke') revoked.value = Boolean(state);
}

onBeforeUnmount(resetCopied);
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm">
        <IconShare2 class="size-4" />
        Share
      </Button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="8"
        :collision-padding="12"
        class="z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold">Share this agent</p>
            <p class="mt-0.5 text-xs leading-snug text-muted-foreground">
              Anyone with the link can chat with this agent in the app, without
              an account. It is the same link the app console manages.
            </p>
          </div>
          <PopoverClose as-child>
            <Button variant="ghost" size="sm" class="-mr-1 -mt-1 size-7 p-0">
              <IconX class="size-4" />
              <span class="sr-only">Close</span>
            </Button>
          </PopoverClose>
        </div>

        <div v-if="loadingLink" class="mt-3 flex justify-center py-3">
          <IconLoader2 class="size-4 animate-spin text-muted-foreground" />
        </div>

        <!-- The read failed: say so and offer it again, rather than guessing. -->
        <div v-else-if="linkUnknown" class="mt-3">
          <p class="text-xs text-destructive">
            Could not load the share link.
          </p>
          <Button
            variant="outline"
            size="sm"
            class="mt-2"
            :disabled="shareStore.pending"
            @click="shareStore.loadLink(agentId)"
          >
            <IconRefresh class="size-4" />
            Try again
          </Button>
        </div>

        <!-- Shared: the link, when it started, and what can be done to it. -->
        <template v-else-if="isShared">
          <div
            v-if="!appUrlMissing"
            class="mt-3 flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5"
          >
            <IconLink class="size-3.5 shrink-0 text-muted-foreground" />
            <input
              :value="shareUrl"
              readonly
              dir="ltr"
              aria-label="Share link"
              class="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
              @focus="selectAll"
            >
            <a
              :href="shareUrl"
              target="_blank"
              rel="noopener"
              class="shrink-0 text-muted-foreground transition hover:text-foreground"
              title="Open in the app"
            >
              <IconExternalLink class="size-3.5" />
              <span class="sr-only">Open in the app</span>
            </a>
          </div>
          <p
            v-else
            class="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs leading-snug text-amber-900 dark:text-amber-200"
          >
            This agent is shared, but admin doesn't know the app's address, so
            it can't build the link. Set
            <code class="font-mono">NUXT_PUBLIC_APP_URL</code> on the admin
            deployment, or copy the link from the app.
          </p>

          <p v-if="sharedSince" class="mt-1.5 text-xs text-muted-foreground">
            Shared {{ sharedSince }}
          </p>

          <div
            v-if="!confirming"
            class="mt-3 flex flex-wrap items-center gap-1.5"
          >
            <Button
              v-if="!appUrlMissing"
              size="sm"
              :disabled="shareStore.pending"
              @click="onCopy"
            >
              <IconCheck v-if="copied" class="size-4" />
              <IconCopy v-else class="size-4" />
              {{ copied ? 'Copied' : 'Copy link' }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="shareStore.pending"
              @click="confirming = 'regenerate'"
            >
              <IconRefresh class="size-4" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="text-destructive hover:text-destructive"
              :disabled="shareStore.pending"
              @click="confirming = 'revoke'"
            >
              <IconBan class="size-4" />
              Revoke
            </Button>
          </div>

          <!-- Two-step confirm, inline: a modal on top of a popover would close
               the popover it is asking about. -->
          <div v-else class="mt-3 rounded-md border bg-muted/40 p-2">
            <p class="text-xs leading-snug">
              {{
                confirming === 'revoke'
                  ? 'Revoke this link? Anyone using it will lose access immediately.'
                  : 'Replace the link? The current one stops working immediately.'
              }}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                variant="destructive"
                size="sm"
                :disabled="shareStore.pending"
                @click="onConfirm"
              >
                <IconLoader2
                  v-if="shareStore.pending"
                  class="size-4 animate-spin"
                />
                {{ confirming === 'revoke' ? 'Revoke link' : 'Replace link' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="shareStore.pending"
                @click="confirming = null"
              >
                Cancel
              </Button>
            </div>
          </div>
        </template>

        <!-- Not shared: one action, and one line saying why there is nothing
             to copy. After a revoke that line reports the revoke instead. -->
        <template v-else>
          <p class="mt-3 text-xs text-muted-foreground">
            {{
              revoked
                ? 'Link revoked.'
                : 'This agent is not shared.'
            }}
          </p>
          <Button
            size="sm"
            class="mt-2"
            :disabled="shareStore.pending"
            @click="onShare"
          >
            <IconLoader2 v-if="shareStore.pending" class="size-4 animate-spin" />
            <IconShare2 v-else class="size-4" />
            Share
          </Button>
        </template>

        <!-- `linkUnknown` renders its own copy of this line above, with a retry. -->
        <p
          v-if="shareStore.error && !linkUnknown"
          class="mt-3 text-xs text-destructive"
        >
          Could not update the share link.
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
