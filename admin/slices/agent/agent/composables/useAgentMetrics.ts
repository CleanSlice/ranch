import type { InjectionKey, MaybeRefOrGetter, Ref } from 'vue';
import type { IAgentMetrics } from '#agent/domain/agent.types';
import { createVisiblePoller } from '#agent/utils/visiblePoller';

/**
 * The pod's live figures for the Overview page (CLEAN-228, research R7): one
 * poll for the page, read by the summary strip (pod load), Configuration
 * ("in use now") and Advanced (node disk).
 *
 * metrics-server samples on a ~15 s window, so 10 s gives near-live numbers
 * without hammering the API. The poll stops while the tab is hidden
 * (`utils/visiblePoller.ts`) and asks again the moment it is shown.
 *
 * Metrics are not an entity with an id and a store: they are a reading of one
 * pod, held here once for as long as the page is open.
 */
export const METRICS_POLL_MS = 10_000;

export interface IAgentMetricsFeed {
  /** `null`: no pod to measure, or the request failed. */
  metrics: Ref<IAgentMetrics | null>;
  /** `false` until the first request has come back, either way. */
  answered: Ref<boolean>;
}

export const AGENT_METRICS_KEY: InjectionKey<IAgentMetricsFeed> =
  Symbol('agentMetrics');

/** Starts the poll with the calling component and hands the feed to its blocks. */
export function provideAgentMetrics(
  id: MaybeRefOrGetter<string>,
): IAgentMetricsFeed {
  const agentStore = useAgentStore();
  const metrics = ref<IAgentMetrics | null>(null);
  const answered = ref(false);

  async function read() {
    const asked = toValue(id);
    let next: IAgentMetrics | null = null;
    try {
      next = await agentStore.fetchMetrics(asked);
    } catch {
      next = null;
    }
    // Another agent since the request left: its answer is not this one's.
    if (asked !== toValue(id)) return;
    metrics.value = next;
    answered.value = true;
  }

  const poller = createVisiblePoller(read, METRICS_POLL_MS);
  onMounted(() => poller.start());
  onBeforeUnmount(() => poller.stop());

  watch(
    () => toValue(id),
    () => {
      metrics.value = null;
      answered.value = false;
      void read();
    },
  );

  const feed: IAgentMetricsFeed = { metrics, answered };
  provide(AGENT_METRICS_KEY, feed);
  return feed;
}

/** The page's metrics feed; an empty, never-answered one outside such a page. */
export function useInjectedAgentMetrics(): IAgentMetricsFeed {
  return (
    inject(AGENT_METRICS_KEY, null) ?? {
      metrics: ref<IAgentMetrics | null>(null),
      answered: ref(false),
    }
  );
}
