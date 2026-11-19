import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';

/**
 * Pin / unpin for the agent header (CLEAN-216). The pin is the signed-in
 * account's own (CLEAN-231): it goes through the pin routes, never through
 * the general update, and whoever can open the agent may set it. Optimistic
 * the way the lifecycle actions are (docs/state.md): the store patches the
 * record at once, so the rail row moves on the click, and a refusal rolls
 * the record back there and surfaces the message here.
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
    try {
      await agentStore.setPinned(agentId, next);
    } catch (err) {
      // Rolled back by the store.
      error.value = (err as Error).message || (next ? 'Pin failed' : 'Unpin failed');
    } finally {
      toggling.value = false;
    }
  }

  return { pinned, toggling, error, toggle };
}
