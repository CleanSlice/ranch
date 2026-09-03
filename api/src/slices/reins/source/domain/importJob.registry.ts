import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IImportJob } from './source.types';

// Finished jobs linger long enough for whoever started the import to come
// back and read the totals, then go. Nothing else references them.
const RETAIN_FINISHED_MS = 60 * 60 * 1000;
const MAX_ERRORS = 20;

export interface IImportJobProgress {
  added?: number;
  skipped?: number;
  failed?: number;
  /** Appended, not replaced; capped at MAX_ERRORS. */
  error?: string;
}

/**
 * In-memory ledger of background bulk imports so the sources page can show
 * "120 / 447 added" instead of asking the user to refresh and guess. Not
 * persisted on purpose: an import runs inside this process and dies with it,
 * so a stored job would only ever describe work that is no longer happening.
 */
@Injectable()
export class ImportJobRegistry {
  private readonly jobs = new Map<string, IImportJob>();

  create(
    knowledgeId: string,
    kind: IImportJob['kind'],
    detected: number,
  ): IImportJob {
    this.prune();
    const job: IImportJob = {
      id: `import-${randomUUID()}`,
      knowledgeId,
      kind,
      status: 'running',
      detected,
      added: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      startedAt: new Date(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  progress(jobId: string, patch: IImportJobProgress): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (patch.added !== undefined) job.added += patch.added;
    if (patch.skipped !== undefined) job.skipped += patch.skipped;
    if (patch.failed !== undefined) job.failed += patch.failed;
    if (patch.error !== undefined && job.errors.length < MAX_ERRORS) {
      job.errors.push(patch.error);
    }
  }

  finish(jobId: string, status: 'done' | 'failed', error?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = status;
    job.finishedAt = new Date();
    // The terminal reason always lands, even when per-entry errors already
    // filled the cap: a job that shows "failed" with no explanation is worse
    // than one line over.
    if (error !== undefined) job.errors.push(error);
  }

  get(jobId: string): IImportJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  listByKnowledge(knowledgeId: string): IImportJob[] {
    this.prune();
    return [...this.jobs.values()]
      .filter((j) => j.knowledgeId === knowledgeId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  private prune(): void {
    const cutoff = Date.now() - RETAIN_FINISHED_MS;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && job.finishedAt.getTime() < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}
