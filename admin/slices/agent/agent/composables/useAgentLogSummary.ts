import { createVisiblePoller } from '#agent/utils/visiblePoller';
import {
  containerWaitingLabelOf,
  logStatusLabelOf,
  parseAgentLogs,
} from '#agent/utils/agentLogs';

/**
 * What the collapsed Logs bar shows, and nothing more (CLEAN-233): the newest
 * line, how many lines sit behind it, and how many of those are warnings.
 *
 * The bar used to mount `useAgentLogs` — a full `tail=1000` read, about
 * 100 kB, every five seconds, to render one line and two numbers. The api
 * counts the window now (`GET /agents/:id/logs/summary`) and sends the line
 * alone, which is a few hundred bytes. The figures are the same figures: the
 * counting rules live in `logLines.ts`, which the api carries byte for byte.
 *
 * Like the full read, this polls only while the tab is being looked at, and
 * reads once the moment it is looked at again.
 */
export function useAgentLogSummary(agentId: string) {
  const agentStore = useAgentStore();

  const line = ref('');
  const total = ref(0);
  const alerts = ref(0);
  const error = ref<string | null>(null);
  const REFRESH_INTERVAL = 5000;

  // The `[...]` markers are the whole answer, so they arrive as the line and
  // are read off it exactly as the panel reads them off a whole response.
  const containerWaitingLabel = computed(() =>
    containerWaitingLabelOf(line.value),
  );
  const statusLabel = computed<string | null>(() => logStatusLabelOf(line.value));

  // Parsed by the same function the panel uses, so the bar's time column and
  // level colour match the first line the panel shows when it opens.
  const latest = computed(() => {
    const lines = parseAgentLogs(line.value)[0]?.lines;
    return lines && lines.length ? (lines[lines.length - 1] ?? null) : null;
  });

  async function refresh() {
    try {
      const summary = await agentStore.fetchLogSummary(agentId);
      line.value = summary.logs;
      total.value = summary.total;
      alerts.value = summary.alerts;
      error.value = null;
    } catch (err) {
      error.value = (err as Error).message || 'Failed to fetch logs';
    }
  }

  const poller = createVisiblePoller(refresh, REFRESH_INTERVAL);
  onMounted(() => poller.start());
  onBeforeUnmount(() => poller.stop());

  return { latest, total, alerts, statusLabel, containerWaitingLabel, error, refresh };
}
