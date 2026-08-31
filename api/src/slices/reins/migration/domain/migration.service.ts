import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { IKnowledgeGateway } from '../../knowledge/domain/knowledge.gateway';
import { KnowledgeService } from '../../knowledge/domain/knowledge.service';
import { IKnowledgeData } from '../../knowledge/domain/knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

const INSTANCE_READY_TIMEOUT_MS = 5 * 60 * 1000;
const INSTANCE_POLL_INTERVAL_MS = 5_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The one-time transition off the shared retrieval pool. Per base: bring its
 * own instance up, re-ingest every source from Ranch's own storage through
 * the ordinary ingest path, and flip reads to the instance by marking the
 * base done. Resumable: per-source indexState is the progress record, so a
 * restart re-reads it and continues. The operator supplies nothing
 * (FR-033/FR-034); the shared deployment stays up as the rollback until
 * every base is through.
 */
@Injectable()
export class MigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationService.name);
  private running: Promise<void> | null = null;

  constructor(
    private readonly knowledgeGateway: IKnowledgeGateway,
    private readonly knowledgeService: KnowledgeService,
    private readonly sources: SourceService,
    private readonly instances: IInstanceGateway,
    private readonly config: IKnowledgeConfigGateway,
  ) {}

  onApplicationBootstrap(): void {
    void this.runIfNeeded();
  }

  /** Idempotent; concurrent calls share one run. */
  runIfNeeded(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<void> {
    try {
      if (!(await this.config.isEnabled())) return;
      const bases = await this.knowledgeGateway.findAll();
      const pending = bases.filter((b) => b.migrationState !== 'done');
      if (pending.length === 0) return;

      this.logger.log(
        `transition: ${pending.length} base(s) still on the shared pool`,
      );
      for (const base of pending) {
        try {
          await this.migrateBase(base);
        } catch (err) {
          this.logger.error(
            `transition failed for ${base.id} (${base.name}): ${errorMessage(err)}`,
          );
          await this.knowledgeGateway.updateMigrationState(base.id, 'failed');
        }
      }

      const after = await this.knowledgeGateway.findAll();
      const left = after.filter((b) => b.migrationState !== 'done').length;
      if (left === 0) {
        this.logger.log(
          'transition complete: every base answers from its own area. ' +
            'The shared deployment is now only the rollback — decommission it deliberately, not automatically.',
        );
      } else {
        this.logger.warn(`transition finished with ${left} base(s) not done`);
      }
    } catch (err) {
      this.logger.error(`transition run crashed: ${errorMessage(err)}`);
    }
  }

  private async migrateBase(base: IKnowledgeData): Promise<void> {
    if (base.migrationState !== 'inProgress') {
      // Requeue BEFORE marking inProgress: a crash between the two leaves
      // the base notStarted with some sources queued, which a restart
      // simply requeues again. The reverse order would let a restart skip
      // sources that were never re-ingested — their backfilled 'indexed'
      // still refers to the shared pool.
      const sources = await this.sources.findByKnowledge(base.id);
      for (const s of sources) {
        await this.sources.requeueSource(s.id);
      }
      await this.knowledgeGateway.updateMigrationState(base.id, 'inProgress');
    }

    await this.knowledgeService.provisionInstance(base);
    const ready = await this.waitForInstanceReady(base.id);
    if (!ready) {
      throw new Error(
        `retrieval instance for ${base.id} did not become ready within ${INSTANCE_READY_TIMEOUT_MS / 60000} minutes`,
      );
    }

    const sources = await this.sources.findByKnowledge(base.id);
    let indexed = 0;
    let failed = 0;
    for (const source of sources) {
      // Resume marker: a source already 'indexed' under an inProgress base
      // was re-ingested into the base's own instance by an earlier pass.
      if (source.indexState === 'indexed') {
        indexed += 1;
        continue;
      }
      try {
        const final = await this.sources.indexSourceAndWait(source);
        if (final.indexState === 'indexed') indexed += 1;
        else failed += 1;
      } catch (err) {
        // Reported per source (a dead URL, a missing S3 object), never
        // dropped and never fatal for the rest of the batch (FR-032).
        failed += 1;
        this.logger.warn(
          `re-ingest failed for source ${source.id} (${source.name}): ${errorMessage(err)}`,
        );
      }
    }

    if (sources.length > 0 && indexed === 0) {
      throw new Error(
        `no source of ${base.name} could be re-processed (${failed} failed)`,
      );
    }

    await this.knowledgeGateway.updateIndexState(base.id, {
      indexStatus: 'ready',
      indexedAt: indexed > 0 ? new Date() : undefined,
      indexError:
        failed === 0 ? null : `${failed} source(s) failed re-processing`,
    });
    // The flip: from here reads route to the base's own instance.
    await this.knowledgeGateway.updateMigrationState(base.id, 'done');
    this.logger.log(
      `base ${base.name} (${base.id}) migrated: ${indexed} indexed, ${failed} failed`,
    );
  }

  private async waitForInstanceReady(knowledgeId: string): Promise<boolean> {
    const deadline = Date.now() + INSTANCE_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.instances.status(knowledgeId);
      await this.knowledgeGateway.updateInstanceState(knowledgeId, {
        instanceState: status.state,
        instanceError: status.error,
        instanceEndpoint: status.endpoint,
      });
      if (status.state === 'ready') return true;
      if (status.state === 'failed') return false;
      await sleep(INSTANCE_POLL_INTERVAL_MS);
    }
    return false;
  }
}
