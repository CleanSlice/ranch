import type { InjectionKey } from 'vue';

/**
 * One delete confirmation per agent page (CLEAN-228, research R11). The
 * workspace header owns the dialog (`delete/Dialog.vue`) and what happens
 * after a deletion — moving on to the next agent in the rail; the Delete
 * block on Overview only asks for it to be opened. Two entry points, one
 * dialog, so they cannot drift.
 */
export const AGENT_DELETE_KEY: InjectionKey<() => void> = Symbol('agentDelete');

/** Called by the component that hosts the dialog. */
export function provideAgentDelete(open: () => void): void {
  provide(AGENT_DELETE_KEY, open);
}

/** Opens the page's delete confirmation; `null` where no page hosts one. */
export function useAgentDeleteRequest(): (() => void) | null {
  return inject(AGENT_DELETE_KEY, null);
}
