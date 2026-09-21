import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { IShareLinkState, ShareService } from '#share/domain';
import { buildShareUrl, resolveAppOrigin } from '#share/utils/shareUrl';

// Re-export the domain types for consumers importing from
// `#share/stores/share`.
export type { IShareLinkState } from '#share/domain';

const getService = createServiceGetter<ShareService>('$shareService');

export const useShareStore = defineStore('share', () => {
  const config = useRuntimeConfig();

  /** Link state, one entry per agent the panel has looked at. */
  const links = ref<Record<string, IShareLinkState>>({});
  const pending = ref(false);
  const error = ref<string | null>(null);

  /**
   * Where the link has to point: the app console, not this one. `null` means
   * nobody told admin where the app lives (see `resolveAppOrigin`).
   */
  const appOrigin = computed(() =>
    resolveAppOrigin(
      (config.public as { appUrl?: string }).appUrl,
      typeof window === 'undefined' ? null : window.location.origin,
    ),
  );

  function withUrl(state: IShareLinkState): IShareLinkState {
    if (!state.active || !state.token || !appOrigin.value) {
      return { ...state, url: null };
    }
    return { ...state, url: buildShareUrl(appOrigin.value, state.token) };
  }

  const linkFor = (agentId: string): IShareLinkState | null =>
    links.value[agentId] ?? null;

  /**
   * Every endpoint answers with the agent's current link state, so the four
   * actions differ only in which call they make: run it, store the result
   * under the agent, hand it back.
   */
  async function run(
    agentId: string,
    call: (service: ShareService) => Promise<IShareLinkState>,
  ): Promise<IShareLinkState | null> {
    pending.value = true;
    error.value = null;
    try {
      const state = withUrl(await call(getService()));
      links.value[agentId] = state;
      return state;
    } catch (err) {
      error.value = (err as Error).message || 'Request failed';
      return null;
    } finally {
      pending.value = false;
    }
  }

  function loadLink(agentId: string) {
    return run(agentId, (service) => service.getLink(agentId));
  }

  /** Idempotent server-side: an agent that is already shared keeps its link. */
  function share(agentId: string) {
    return run(agentId, (service) => service.share(agentId));
  }

  function regenerate(agentId: string) {
    return run(agentId, (service) => service.regenerate(agentId));
  }

  function revoke(agentId: string) {
    return run(agentId, (service) => service.revoke(agentId));
  }

  return {
    links,
    pending,
    error,
    appOrigin,
    linkFor,
    loadLink,
    share,
    regenerate,
    revoke,
  };
});
