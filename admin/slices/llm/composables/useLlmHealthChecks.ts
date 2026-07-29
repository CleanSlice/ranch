import type {
  ILlmCredentialData,
  ILlmHealthCheckResult,
} from '#llm/stores/llm';

/**
 * On-demand health checks for LLM credentials, keyed by credential id.
 * Results live only for the page's lifetime — a check is a live probe, not
 * persisted state.
 */
export function useLlmHealthChecks() {
  const llmStore = useLlmStore();

  const checking = ref<Record<string, boolean>>({});
  const results = ref<Record<string, ILlmHealthCheckResult>>({});

  async function check(item: ILlmCredentialData) {
    checking.value[item.id] = true;
    try {
      results.value[item.id] = await llmStore.checkHealth(item.id);
    } catch (err) {
      results.value[item.id] = {
        ok: false,
        latencyMs: 0,
        provider: item.provider,
        model: item.model,
        error: (err as Error).message,
      };
    } finally {
      checking.value[item.id] = false;
    }
  }

  function title(item: ILlmCredentialData): string {
    if (checking.value[item.id]) return 'Checking…';
    const r = results.value[item.id];
    if (!r) return 'Not tested yet';
    if (r.ok) return `OK · ${r.latencyMs} ms`;
    return `Failed: ${r.error ?? 'unknown error'}`;
  }

  return { checking, results, check, title };
}
