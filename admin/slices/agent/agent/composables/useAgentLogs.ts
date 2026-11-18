import { createVisiblePoller } from '#agent/utils/visiblePoller';
import {
  containerWaitingLabelOf,
  logStatusLabelOf,
} from '#agent/utils/agentLogs';

/**
 * Pod logs for one agent: fetch, error state, 5s auto-refresh and the
 * "[container <reason>]" placeholder parsing. The interval lives with the
 * calling component — unmounting the logs panel stops the polling, so a
 * closed panel never keeps hitting the API.
 *
 * The refresh is a visible poll (CLEAN-233): a full read is about 100 kB, and
 * a backgrounded tab asking for one every five seconds pays that for nobody.
 * Coming back to the tab reads once at once, so what is on screen is never
 * the log of ten minutes ago.
 */
export function useAgentLogs(agentId: string) {
  const agentStore = useAgentStore();

  const logs = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const autoRefresh = ref(true);
  const scrollRef = ref<HTMLElement | null>(null);
  const REFRESH_INTERVAL = 5000;

  const containerWaitingLabel = computed(() =>
    containerWaitingLabelOf(logs.value),
  );
  const statusLabel = computed<string | null>(() =>
    logStatusLabelOf(logs.value),
  );

  const logGroups = computed(() => parseAgentLogs(logs.value));

  // Terminal-style stickiness: after a refresh, jump to the bottom only when
  // the user was already there — if they scrolled up to read, the 5s poll
  // must not yank their position away.
  const STICK_THRESHOLD_PX = 40;

  async function refresh() {
    loading.value = true;
    error.value = null;
    const el = scrollRef.value;
    const stickToBottom =
      !el || el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    try {
      logs.value = await agentStore.fetchLogs(agentId);
      await nextTick();
      if (scrollRef.value && stickToBottom) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
      }
    } catch (err) {
      error.value = (err as Error).message || 'Failed to fetch logs';
    } finally {
      loading.value = false;
    }
  }

  // One poller for the life of the composable; `autoRefresh` starts and stops
  // it, and it reads once the moment it starts — which is what the old
  // `onMounted(refresh)` did, minus the second request that arrived with it.
  const poller = createVisiblePoller(refresh, REFRESH_INTERVAL);

  watch(
    autoRefresh,
    (on) => {
      if (on) poller.start();
      else poller.stop();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => poller.stop());

  return {
    logs,
    logGroups,
    statusLabel,
    loading,
    error,
    autoRefresh,
    scrollRef,
    containerWaitingLabel,
    refresh,
  };
}
