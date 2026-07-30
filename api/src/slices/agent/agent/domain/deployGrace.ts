import { IAgentData } from './agent.types';

// Single source of truth for the deploy grace window AND the definitive-
// failure safety timeout: after a deploy is submitted, the two-step Argo
// workflow (cleanup-old → run-agent) legitimately leaves the agent pod-less
// for ~10-30s. Within this window the absence of a pod is not evidence of
// failure; once it expires with no pod, the startup is definitively failed.
export const DEPLOY_GRACE_MS = 5 * 60_000;

export function isWithinDeployGrace(
  agent: Pick<IAgentData, 'lastDeployStartedAt' | 'updatedAt'>,
  now: number = Date.now(),
): boolean {
  // Legacy rows deployed before lastDeployStartedAt existed have no anchor;
  // fall back to updatedAt so an agent mid-deploy during rollout still gets
  // its grace window instead of an instant drift-fail.
  const anchor = agent.lastDeployStartedAt ?? agent.updatedAt;
  return now - anchor.getTime() <= DEPLOY_GRACE_MS;
}
