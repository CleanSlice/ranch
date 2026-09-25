import type { MaybeRefOrGetter } from 'vue';

/**
 * The owner side of an agent's share link, as the admin console shows it
 * (CLEAN-104, re-homed by specs/017).
 *
 * This drives the same endpoints the app console's share panel drives, so
 * there is one link per agent no matter which console touched it last — and
 * that link opens the app's `/share` page, never anything in admin. Nothing
 * here keeps a copy of the link: it reads `shareStore.linkFor(agentId)`
 * (docs/state.md).
 *
 * Presentation lives in `ShareMenuSub` (rows of the agent header's menu);
 * this composable is the former floating panel's script, lifted so the rows
 * stay template-only.
 */
export function useShareLink(agentId: MaybeRefOrGetter<string>) {
  const shareStore = useShareStore();

  const id = computed(() => toValue(agentId));

  const copied = ref(false);
  /** Which destructive action is waiting for its inline confirmation, if any. */
  const confirming = ref<'revoke' | 'regenerate' | null>(null);
  /** Set once after a successful revoke so the empty state isn't silent. */
  const revoked = ref(false);

  const link = computed(() => shareStore.linkFor(id.value));

  const isShared = computed(() => Boolean(link.value?.active));

  /**
   * Shared, but admin could not work out where the app lives
   * (`resolveAppOrigin`), so there is no URL to hand out. Revoke and
   * Regenerate still work — they need no URL.
   */
  const appUrlMissing = computed(() => isShared.value && !link.value?.url);

  const shareUrl = computed(() => link.value?.url ?? '');

  /**
   * First read for this agent. Without this the rows would flash "not shared"
   * with a Share row under the cursor while the real state is still in
   * flight — on an agent that already has a link.
   */
  const loadingLink = computed(() => shareStore.pending && !link.value);

  /**
   * The read failed and there is nothing to render: claiming "not shared"
   * here would be a guess. Offer the retry instead.
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

  const pending = computed(() => shareStore.pending);
  const error = computed(() => shareStore.error);

  // ---------------------------------------------------------------- clipboard

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
      // Clipboard writes are refused in some contexts (insecure origin,
      // denied permission). "Open in the app" is the fallback the operator
      // already has — an error row would be noise.
    }
  }

  // ------------------------------------------------------------- open / reset

  /** What opening the panel used to do: forget transient state, then *read*
   *  the link. Reading only — reopening must show the existing link, never
   *  mint a new one. Creating is what Share is for. */
  function reset() {
    confirming.value = null;
    revoked.value = false;
    resetCopied();
    void shareStore.loadLink(id.value);
  }

  function loadLink() {
    return shareStore.loadLink(id.value);
  }

  // --------------------------------------------------------------- the actions

  async function onShare() {
    revoked.value = false;
    await shareStore.share(id.value);
  }

  function cancelConfirm() {
    confirming.value = null;
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
        ? await shareStore.revoke(id.value)
        : await shareStore.regenerate(id.value);
    confirming.value = null;
    if (action === 'revoke') revoked.value = Boolean(state);
  }

  onBeforeUnmount(resetCopied);

  return {
    link,
    isShared,
    appUrlMissing,
    shareUrl,
    loadingLink,
    linkUnknown,
    sharedSince,
    copied,
    confirming,
    revoked,
    pending,
    error,
    reset,
    loadLink,
    onCopy,
    onShare,
    onConfirm,
    cancelConfirm,
  };
}
