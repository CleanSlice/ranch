import { lastAgentKey } from '#bridle/utils/storageKeys';

/**
 * Which agent to open when someone lands on the agents area.
 *
 * A convenience, not synced state: it lives in this browser only, so a second
 * device simply falls back to the first running agent. It is kept per
 * account (CLEAN-231): the key carries the signed-in id, so a second person
 * on a shared browser is not taken to the agent the first one had open.
 * Every read is still validated against what the user can actually see right
 * now, so a deleted agent or a revoked visibility does not strand the next
 * visit on a dead id.
 */
export function useLastAgent() {
  // Read on every call, not once: the composable outlives a sign-in.
  const key = (): string | null =>
    lastAgentKey(useAuthStore().user?.id ?? null);

  function read(): string | null {
    const storageKey = key();
    if (typeof window === 'undefined' || !storageKey) return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function remember(id: string): void {
    const storageKey = key();
    if (typeof window === 'undefined' || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, id);
    } catch {
      // Quota or private mode — losing the memory costs one extra click.
    }
  }

  /**
   * Remembered agent → first running → first in the list → nothing.
   * "First running" beats "first in the list" because an agent you can
   * actually talk to is a better landing than one that is stopped.
   */
  function resolveLanding<T extends { id: string; status: string }>(
    agents: T[],
  ): T | null {
    if (!agents.length) return null;
    const remembered = read();
    const stored = remembered
      ? agents.find((a) => a.id === remembered)
      : undefined;
    if (stored) return stored;
    return agents.find((a) => a.status === 'running') ?? agents[0] ?? null;
  }

  return { read, remember, resolveLanding };
}
