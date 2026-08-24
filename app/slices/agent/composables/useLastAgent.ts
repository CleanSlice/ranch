const LAST_AGENT_KEY = 'agent:lastOpened';

/**
 * Which agent to open when someone lands on the agents area.
 *
 * A convenience, not synced state: it lives in this browser only, so a second
 * device simply falls back to the first running agent. Every read is
 * validated against what the user can actually see right now — without that
 * check a deleted agent, a revoked visibility, or a second user on a shared
 * browser would strand the next visit on a dead id.
 */
export function useLastAgent() {
  function read(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(LAST_AGENT_KEY);
    } catch {
      return null;
    }
  }

  function remember(id: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LAST_AGENT_KEY, id);
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
