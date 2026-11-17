import type { MaybeRefOrGetter } from 'vue';
import { canManageAgent, isOwnerRole } from '#agent/utils/agentAccess';

/**
 * The signed-in viewer against one agent (CLEAN-232): `canManage` gates every
 * management control and every request behind one, `isOwner` the things that
 * are the Owner's on any agent (which agent is the Ranch admin agent).
 *
 * An agent that is not known yet is not manageable: nothing is offered and
 * nothing is asked of the API until the record says which agent it is.
 */
export function useAgentAccess(
  agent: MaybeRefOrGetter<{ isAdmin: boolean } | null | undefined>,
) {
  const auth = useAuthStore();

  const isOwner = computed(() => isOwnerRole(auth.user?.role));
  const canManage = computed(() => {
    const current = toValue(agent);
    return current ? canManageAgent(auth.user?.role, current) : false;
  });

  return { isOwner, canManage };
}
