import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { IFileGateway, TranscriptReaderService } from '#/agent/file/domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { IChatGateway } from './chat.gateway';
import { IChatReconcileInput, IChatSyncResult } from './chat.types';

const SESSIONS_PREFIX = 'data/sessions/';
const PREVIEW_MAX = 200;

/**
 * Reconciles the Postgres chat index against the agent runtimes' JSONL session
 * files in S3 (the source of truth for message content). Runs on demand
 * (`POST /chats/sync`) and, if `CHAT_SYNC_INTERVAL_SEC` is set, on an interval.
 *
 * Ranch has no scheduler facility, so we use a plain `setInterval` in an
 * OnModuleInit service — the same pattern as agentStatus.service's driftTimer.
 */
@Injectable()
export class ChatSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatSyncService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly files: IFileGateway,
    private readonly reader: TranscriptReaderService,
    private readonly chats: IChatGateway,
    private readonly agents: IAgentGateway,
  ) {}

  onModuleInit(): void {
    const sec = Number(process.env.CHAT_SYNC_INTERVAL_SEC ?? 0);
    if (!Number.isFinite(sec) || sec <= 0) return;
    this.logger.log(`chat reconcile interval enabled: every ${sec}s`);
    this.timer = setInterval(() => {
      void this.syncAll().catch((err) =>
        this.logger.error(
          `scheduled reconcile failed: ${(err as Error).message}`,
        ),
      );
    }, sec * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reconcile every agent (or just one). Guarded against overlapping runs. */
  async syncAll(agentId?: string): Promise<IChatSyncResult> {
    if (this.running) {
      this.logger.warn('reconcile already in progress — skipping');
      return { scannedAgents: 0, scannedFiles: 0, upserted: 0, skipped: 0 };
    }
    this.running = true;
    const result: IChatSyncResult = {
      scannedAgents: 0,
      scannedFiles: 0,
      upserted: 0,
      skipped: 0,
    };
    try {
      const agentIds = agentId
        ? [agentId]
        : (await this.agents.findAll()).map((a) => a.id);
      for (const id of agentIds) {
        result.scannedAgents++;
        await this.syncAgent(id, result);
      }
    } finally {
      this.running = false;
    }
    this.logger.log(
      `reconcile done: agents=${result.scannedAgents} files=${result.scannedFiles} ` +
        `upserted=${result.upserted} skipped=${result.skipped}`,
    );
    return result;
  }

  /**
   * Reconcile only ONE end user's own bridle sessions (App "my history" —
   * `POST /me/chats/sync`). Scans the agent(s) but reconciles just files whose
   * parsed externalUserId matches: a self-service, non-admin equivalent of
   * syncAll. Not guarded by `running` (scoped + read-only), so it can run
   * alongside the interval reconcile.
   */
  async syncForExternalUser(
    externalUserId: string,
    agentId?: string,
  ): Promise<IChatSyncResult> {
    const result: IChatSyncResult = {
      scannedAgents: 0,
      scannedFiles: 0,
      upserted: 0,
      skipped: 0,
    };
    const agentIds = agentId
      ? [agentId]
      : (await this.agents.findAll()).map((a) => a.id);
    const mine = (m: { channel: string; externalUserId: string }): boolean =>
      m.channel === 'bridle' && m.externalUserId === externalUserId;
    for (const id of agentIds) {
      result.scannedAgents++;
      await this.syncAgent(id, result, mine);
    }
    this.logger.log(
      `user reconcile (${externalUserId}) done: agents=${result.scannedAgents} ` +
        `files=${result.scannedFiles} upserted=${result.upserted} skipped=${result.skipped}`,
    );
    return result;
  }

  private async syncAgent(
    agentId: string,
    result: IChatSyncResult,
    filter?: (meta: { channel: string; externalUserId: string }) => boolean,
  ): Promise<void> {
    let nodes;
    try {
      nodes = await this.files.list(agentId);
    } catch (err) {
      this.logger.warn(`list failed for ${agentId}: ${(err as Error).message}`);
      return;
    }

    const sessionFiles = nodes.filter(
      (n) => n.path.startsWith(SESSIONS_PREFIX) && n.path.endsWith('.jsonl'),
    );
    if (!sessionFiles.length) return;

    // One read of existing rows → size map, so we only re-read changed files.
    const existing = await this.chats.list({
      agentId,
      includeInternal: true,
      perPage: 100_000,
    });
    const sizeByKey = new Map(
      existing.items.map((s) => [s.sessionKey, s.lastIndexedSize]),
    );

    for (const node of sessionFiles) {
      const meta = this.parseName(node.path);
      if (!meta) continue;
      if (filter && !filter(meta)) continue;
      result.scannedFiles++;

      if (sizeByKey.get(meta.sessionKey) === node.size) {
        result.skipped++;
        continue;
      }

      try {
        const input = await this.buildReconcileInput(
          agentId,
          node.path,
          node.size,
          meta,
        );
        await this.chats.reconcileUpsert(input);
        result.upserted++;
      } catch (err) {
        this.logger.warn(
          `reconcile ${agentId}/${node.path} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private async buildReconcileInput(
    agentId: string,
    path: string,
    size: number,
    meta: {
      sessionKey: string;
      channel: string;
      externalUserId: string;
      archived: boolean;
    },
  ): Promise<IChatReconcileInput> {
    const messages = await this.reader.read(agentId, path, {
      types: ['user', 'assistant'],
      filterTransient: true,
    });
    const last = messages[messages.length - 1];
    const userMessageCount = messages.reduce(
      (n, m) => (m.role === 'user' ? n + 1 : n),
      0,
    );
    return {
      agentId,
      ...meta,
      title: null,
      size,
      messageCount: messages.length,
      userMessageCount,
      lastMessageAt: last ? new Date(last.ts) : new Date(0),
      preview: last ? last.text.slice(0, PREVIEW_MAX) : null,
      lastRole: last ? last.role : null,
    };
  }

  // `data/sessions/bridle:admin.jsonl` → { sessionKey:'bridle:admin', channel:'bridle',
  // externalUserId:'admin', archived:false }. Archived files are
  // `bridle:admin.<iso-ts>.archived.jsonl` → their own row, archived:true.
  private parseName(path: string): {
    sessionKey: string;
    channel: string;
    externalUserId: string;
    archived: boolean;
  } | null {
    const base = path.slice(SESSIONS_PREFIX.length, -'.jsonl'.length);
    const colon = base.indexOf(':');
    if (colon < 0) return null;
    const channel = base.slice(0, colon);
    const rest = base.slice(colon + 1);
    const dot = rest.indexOf('.');
    const externalUserId = dot < 0 ? rest : rest.slice(0, dot);
    if (!channel || !externalUserId) return null;
    return {
      sessionKey: base,
      channel,
      externalUserId,
      archived: base.endsWith('.archived'),
    };
  }
}
