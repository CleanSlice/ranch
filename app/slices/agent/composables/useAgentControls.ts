import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';

export type AgentControlAction = 'restart' | 'stop' | 'start';

/**
 * Restart / stop / start for the agent sheet. The optimistic status flip and
 * its rollback live in the store, on the one record the orbit node, the rail
 * row and the chat overlay all read — so every surface moves together.
 */
export function useAgentControls(agent: Ref<IAgentData | null | undefined>) {
  const agentStore = useAgentStore();

  const busy = ref<AgentControlAction | null>(null);
  const failed = ref<{ action: AgentControlAction; message: string | null } | null>(
    null,
  );

  const TRANSITIONAL = new Set(['pending', 'deploying']);
  const transitioning = computed(
    () =>
      busy.value !== null ||
      (agent.value ? TRANSITIONAL.has(agent.value.status) : false),
  );
  /** A stopped or failed agent is started; anything else is stopped. */
  const canStart = computed(() =>
    agent.value ? ['stopped', 'failed'].includes(agent.value.status) : false,
  );

  async function run(action: AgentControlAction) {
    if (!agent.value || busy.value) return;
    const id = agent.value.id;
    busy.value = action;
    failed.value = null;
    try {
      if (action === 'restart') await agentStore.restart(id);
      else if (action === 'stop') await agentStore.stop(id);
      else await agentStore.start(id);
    } catch (err) {
      // A 401 the api plugin could not recover from is the session-ended
      // dialog's story to tell (CLEAN-72); any other detail is shown as
      // received.
      const status = (err as { response?: { status?: number } } | null)
        ?.response?.status;
      failed.value = {
        action,
        message: status === 401 ? null : (err as Error).message || null,
      };
    } finally {
      busy.value = null;
    }
  }

  return {
    busy,
    failed,
    transitioning,
    canStart,
    restart: () => run('restart'),
    stop: () => run('stop'),
    start: () => run('start'),
    dismiss: () => {
      failed.value = null;
    },
  };
}
