import type { ISkillDependentAgent } from '#skill/stores/skill';
import { AgentsService } from '#api/data';

export type SkillRedeployStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ISkillRedeployRow {
  agent: ISkillDependentAgent;
  status: SkillRedeployStatus;
  error?: string;
}

/**
 * Redeploy of agents that bundle a skill via their template — after the skill
 * changes, running pods keep the old copy until restarted. Shared by the edit
 * and import-by-URL flows (used to be copy-pasted in both).
 */
export function useSkillRedeploy() {
  const skillStore = useSkillStore();

  const agents = ref<ISkillDependentAgent[]>([]);
  const rows = ref<ISkillRedeployRow[]>([]);
  const redeploying = ref(false);

  /** Fetch the dependents for a skill; returns them for open-modal decisions. */
  async function load(skillId: string) {
    agents.value = await skillStore.fetchDependentAgents(skillId);
    rows.value = [];
    return agents.value;
  }

  async function start() {
    if (redeploying.value || agents.value.length === 0) return;
    redeploying.value = true;
    rows.value = agents.value.map((agent) => ({
      agent,
      status: 'pending' as const,
    }));
    // Sequential: each restart cancels the workflow and resubmits. Going
    // one-at-a-time keeps the UI honest (per-agent ✓ / ✗) and avoids slamming
    // the cluster scheduler with N parallel pod evictions.
    for (const row of rows.value) {
      row.status = 'running';
      try {
        await AgentsService.agentControllerRestart({ path: { id: row.agent.id } });
        row.status = 'done';
      } catch (err) {
        row.status = 'failed';
        row.error = (err as Error).message;
      }
    }
    redeploying.value = false;
  }

  function reset() {
    if (redeploying.value) return;
    agents.value = [];
    rows.value = [];
  }

  return { agents, rows, redeploying, load, start, reset };
}
