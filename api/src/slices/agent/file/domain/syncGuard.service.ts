import { Injectable } from '@nestjs/common';
import { IFileGateway } from './file.gateway';
import { IFileNode } from './file.types';

// The runtime pulls its working copy at boot, moments BEFORE the bridle
// connect that records lastPullAt. S3 writes landing inside that window would
// otherwise compare as older than the marker and slip through — widen the
// baseline backwards instead. Over-warning is acceptable; a missed conflict
// (silent overwrite) is not. No margin on lastSyncAt: sync's own S3 writes
// complete before sync_done, so a margin there would flag every file the
// sync itself just pushed.
export const PULL_MARGIN_MS = 60_000;

export interface ISyncRiskAssessment {
  baseline: Date | null;
  atRisk: IFileNode[];
}

/**
 * CLEAN-50 sync guard: detects S3 objects modified after the moment the pod
 * last aligned with S3 (boot pull or completed Sync push). Those objects are
 * "at risk" — a Sync could overwrite or delete them if the pod's local copy
 * also changed. The platform cannot see the pod's local state, so this is an
 * upper bound by design (false positives possible, false negatives not).
 */
@Injectable()
export class SyncGuardService {
  constructor(private readonly files: IFileGateway) {}

  computeBaseline(
    lastPullAt: Date | null,
    lastSyncAt: Date | null,
  ): Date | null {
    const candidates: number[] = [];
    if (lastPullAt) candidates.push(lastPullAt.getTime() - PULL_MARGIN_MS);
    if (lastSyncAt) candidates.push(lastSyncAt.getTime());
    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates));
  }

  async assess(
    agentId: string,
    lastPullAt: Date | null,
    lastSyncAt: Date | null,
  ): Promise<ISyncRiskAssessment> {
    const baseline = this.computeBaseline(lastPullAt, lastSyncAt);
    // No markers ⇒ agent predates this feature (not restarted since) —
    // behave exactly as before the guard existed.
    if (!baseline) return { baseline: null, atRisk: [] };
    const nodes = await this.files.list(agentId);
    const atRisk = nodes.filter(
      (n) => n.updatedAt.getTime() > baseline.getTime(),
    );
    return { baseline, atRisk };
  }
}
