/**
 * Pod logs for one agent: fetch, error state, 5s auto-refresh and the
 * "[container <reason>]" placeholder parsing. The interval lives with the
 * calling component — unmounting the logs panel stops the polling, so a
 * closed panel never keeps hitting the API.
 */
export function useAgentLogs(agentId: string) {
  const agentStore = useAgentStore();

  const logs = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const autoRefresh = ref(true);
  const scrollRef = ref<HTMLElement | null>(null);
  const REFRESH_INTERVAL = 5000;

  // Backend returns `[container <reason>]` (e.g., "containercreating",
  // "podinitializing") instead of the cryptic K8s 400 when the pod exists but
  // the container hasn't booted yet. Detect that shape so the panel can render
  // a spinner+message instead of a literal "[container containercreating]".
  const containerWaitingLabel = computed(() => {
    const m = logs.value.trim().match(/^\[container ([a-z0-9_]+)\]$/i);
    const r = m?.[1];
    if (!r) return null;
    // Camel-case the K8s reason for display: containercreating →
    // Container creating (k8s sends it CamelCase; backend lowercases it).
    if (r === 'containercreating') return 'Container creating';
    if (r === 'podinitializing') return 'Pod initializing';
    return r.replace(/\b\w/g, (c) => c.toUpperCase());
  });

  // The other whole-response backend markers (the `[container …]` one has its
  // own spinner branch above). Never mixed with real log lines — check this
  // before rendering logGroups so markers don't leak in as an undated group.
  const statusLabel = computed<string | null>(() => {
    const t = logs.value.trim();
    const noPod = t.match(/^\[no pod yet for (\w+) agent\]$/);
    if (noPod) return `No pod yet — agent is ${noPod[1]}.`;
    const failed = t.match(/^\[log fetch failed: ([\s\S]+)\]$/);
    if (failed) return `Log fetch failed: ${failed[1]}`;
    return null;
  });

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

  let timer: ReturnType<typeof setInterval> | null = null;
  watch(
    autoRefresh,
    (on) => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (on) timer = setInterval(refresh, REFRESH_INTERVAL);
    },
    { immediate: true },
  );

  onMounted(refresh);
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });

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
