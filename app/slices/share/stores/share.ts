import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IShareLinkState,
  IShareResolved,
  ShareResolveOutcome,
  ShareService,
} from '#share/domain';

// Re-export the domain types so components importing them from
// `#share/stores/share` keep working, the way the agent and bridle stores do.
export type {
  IShareContext,
  IShareLinkState,
  IShareResolved,
  ShareResolveOutcome,
} from '#share/domain';

const getService = createServiceGetter<ShareService>('$shareService');

/**
 * A 401 the api plugin could not recover from has already raised the
 * session-ended dialog; the panel must not echo a raw auth string beside it
 * (CLEAN-72). Everything else keeps its message.
 */
function errorText(err: unknown): string | null {
  const status = (err as { response?: { status?: number } } | null)?.response
    ?.status;
  if (status === 401) return null;
  return (err as Error).message;
}

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
      error.value = errorText(err);
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
   * Visitor side. The page re-resolves every 30 s, so this has to separate
   * "the API says this link is dead" from "we could not ask": clearing
   * `resolved` on any failure would throw a visitor out of a working
   * conversation the moment their wifi blinked.
   *
   * `invalid` covers unknown, revoked and regenerated tokens alike — the API
   * answers all three with the same 404 on purpose (FR-013), so the page has
   * exactly one "this link is invalid or no longer active" state to render.
   * `unavailable` keeps the last good `resolved` untouched, and covers the
   * unreadable-200 case too: the gateway throws rather than answering `null`,
   * precisely so a broken body cannot be mistaken for a dead link.
   */
  async function resolve(token: string): Promise<ShareResolveOutcome> {
    pending.value = true;
    error.value = null;
    try {
      // `null` here is the gateway's word for "the API answered 404".
      const next = await getService().resolve(token);
      resolved.value = next;
      return next ? 'resolved' : 'invalid';
    } catch (err) {
      error.value = errorText(err);
      return 'unavailable';
    } finally {
      pending.value = false;
    }
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
