import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IShareLinkState,
  IShareResolved,
  ShareService,
} from '#share/domain';

// Re-export the domain types so components importing them from
// `#share/stores/share` keep working, the way the agent and bridle stores do.
export type {
  IShareContext,
  IShareLinkState,
  IShareResolved,
} from '#share/domain';

const getService = createServiceGetter<ShareService>('$shareService');

/**
 * The API never learns the console's origin (`runtimeConfig.public.apiUrl` is
 * the *API* host), so the shareable URL is assembled here — the one place that
 * knows both the token and the browser's address bar.
 */
function withUrl(state: IShareLinkState): IShareLinkState {
  if (!state.active || !state.token || typeof window === 'undefined') {
    return { ...state, url: null };
  }
  return {
    ...state,
    url: `${window.location.origin}/share?token=${state.token}`,
  };
}

export const useShareStore = defineStore('share', () => {
  /** Owner-side link state, one entry per agent the panel has looked at. */
  const links = ref<Record<string, IShareLinkState>>({});
  const pending = ref(false);
  const error = ref<string | null>(null);
  /** Visitor side: the agent behind the token in the current page's URL. */
  const resolved = ref<IShareResolved | null>(null);

  const linkFor = (agentId: string): IShareLinkState | null =>
    links.value[agentId] ?? null;

  /**
   * Every owner-side endpoint answers with the agent's current link state, so
   * the four actions differ only in which call they make: run it, store the
   * result under the agent, hand it back.
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
      error.value = (err as Error).message;
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

  /**
   * Visitor side. `null` covers unknown, revoked and malformed tokens alike —
   * the API answers all three identically on purpose (FR-013), so the page has
   * exactly one "this link is invalid or no longer active" state to render.
   */
  async function resolve(token: string): Promise<IShareResolved | null> {
    pending.value = true;
    error.value = null;
    try {
      resolved.value = await getService().resolve(token);
    } catch (err) {
      error.value = (err as Error).message;
      resolved.value = null;
    } finally {
      pending.value = false;
    }
    return resolved.value;
  }

  return {
    links,
    pending,
    error,
    resolved,
    linkFor,
    loadLink,
    share,
    regenerate,
    revoke,
    resolve,
  };
});
