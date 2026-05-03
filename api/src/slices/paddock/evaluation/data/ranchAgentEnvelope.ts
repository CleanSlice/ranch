import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { tmpdir } from 'os';
import { IFileGateway } from '#/agent/file/domain';

export interface IRanchAgentEnvelope {
  agentDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Files / directories we never want in the eval envelope. We want a CLEAN
 * agent state: scenarios should run against fresh memory + sessions, not
 * against the live agent's accumulated data. Plus binary SQLite files often
 * arrive malformed from S3 (open WAL, partial sync) and crash the runtime
 * with `database disk image is malformed`.
 */
const SKIP_PATH_PREFIXES = [
  'data/',
  'sessions/',
  'workspace/',
];

const SKIP_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
  '.db-wal',
  '.db-shm',
  '.db-journal',
]);

/**
 * Materializes the bootstrap subset of an agent's files (`agents/{agentId}/...`
 * in S3) into a temporary directory so paddock's FilesystemAgentRunner can boot
 * an ephemeral runtime. Only personality / config / skills / memory text is
 * copied — sessions, sqlite DBs, and workspace are deliberately skipped so the
 * eval runs against a clean state.
 */
@Injectable()
export class RanchAgentEnvelope {
  private readonly logger = new Logger(RanchAgentEnvelope.name);

  constructor(private files: IFileGateway) {}

  async materialize(agentId: string): Promise<IRanchAgentEnvelope> {
    const agentDir = join(
      tmpdir(),
      `ranch-paddock-${agentId}-${Date.now()}`,
    );
    await mkdir(agentDir, { recursive: true });

    let nodes: { path: string }[];
    try {
      nodes = await this.files.list(agentId);
    } catch (err) {
      this.logger.warn(
        `Could not list files for agent ${agentId}: ${(err as Error).message}`,
      );
      nodes = [];
    }

    let copied = 0;
    let skipped = 0;
    for (const node of nodes) {
      if (this.shouldSkip(node.path)) {
        skipped++;
        continue;
      }
      try {
        const content = await this.files.read(agentId, node.path);
        const fullPath = join(agentDir, node.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content.content, 'utf-8');
        copied++;
      } catch (err) {
        this.logger.warn(
          `Skipping ${node.path} for agent ${agentId}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Materialized agent ${agentId}: ${copied} files copied, ${skipped} skipped (data/sessions/sqlite excluded)`,
    );

    return {
      agentDir,
      cleanup: async () => {
        try {
          await rm(agentDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  private shouldSkip(path: string): boolean {
    if (SKIP_PATH_PREFIXES.some((p) => path.startsWith(p))) return true;
    const ext = extname(path).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return true;
    return false;
  }
}
