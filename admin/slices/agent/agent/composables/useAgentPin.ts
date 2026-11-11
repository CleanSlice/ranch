import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';

/**
 * Pin / unpin for the agent header (CLEAN-216). Optimistic the way the
 * lifecycle actions are (docs/state.md): the store record is patched at once,
 * so the rail row moves on the click, the general update carries the flag,
 * and a refusal rolls the record back and surfaces the message.
 *
 * Deliberately never calls `markPendingRestart`: the visibility and edit
 * forms do, because their fields reach the pod on the next restart. The pin
 * never reaches the pod — it is a list order and an icon — so a "restart to
 * apply" banner after pinning would be a lie.
 */
export function useAgentPin(
  agentId: string,
  agent: Ref<IAgentData | null | undefined>,
) {
  const agentStore = useAgentStore();

  const pinned = computed(() => agent.value?.pinned === true);
  const toggling = ref(false);
  const error = ref<string | null>(null);

  async function toggle() {
    if (!agent.value || toggling.value) return;
    const next = !agent.value.pinned;
    toggling.value = true;
    error.value = null;
    const rollback = agentStore.patch(agentId, { pinned: next });
    try {
      await agentStore.update(agentId, { pinned: next });
    } catch (err) {
      rollback();
      error.value = (err as Error).message || (next ? 'Pin failed' : 'Unpin failed');
    } finally {
      toggling.value = false;
    }
  }

  return { pinned, toggling, error, toggle };
}
