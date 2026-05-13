import { Injectable } from '@nestjs/common';

// Per-agent deploy cutoff. AgentDeployService marks the moment a restart
// begins; AgentStatusService.reconcileDbStatus consults it before applying
// Failed pod events. Without this, the dying OLD pod (cancelled by Argo on
// restart) emits a MODIFIED phase=Failed event between cancelAgentWorkflow()
// and deploy()'s updateStatus('deploying'), pinning the DB to 'failed' and
// hiding the 'deploying' transition from the UI.
//
// In-memory by design — the cutoff is only meaningful for the current
// restart; an API process recycle invalidates it harmlessly (startup drift
// detection re-reconciles everything against live pod state).
@Injectable()
export class DeployTracker {
  private readonly cutoffs = new Map<string, number>();

  mark(agentId: string): void {
    this.cutoffs.set(agentId, Date.now());
  }

  // A pod whose startedAt predates the latest mark() for this agent belongs
  // to a previous workflow — its phase transitions (especially Failed
  // during Argo cancellation) should not affect DB status.
  isStale(agentId: string, podStartedAt: string | null): boolean {
    const cutoff = this.cutoffs.get(agentId);
    if (cutoff === undefined) return false;
    if (!podStartedAt) return false;
    return new Date(podStartedAt).getTime() < cutoff;
  }

  clear(agentId: string): void {
    this.cutoffs.delete(agentId);
  }
}
