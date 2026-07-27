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

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      logs.value = await agentStore.fetchLogs(agentId);
      await nextTick();
      if (scrollRef.value) {
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
    loading,
    error,
    autoRefresh,
    scrollRef,
    containerWaitingLabel,
    refresh,
  };
}
