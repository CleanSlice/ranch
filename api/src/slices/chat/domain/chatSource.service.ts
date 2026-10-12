import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ISourceGateway } from '#/reins/source/domain/source.gateway';
import { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import { boundKnowledgeIds } from '#/reins/knowledge/domain/boundKnowledge';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { ITemplateGateway } from '#/agent/template/domain';
import { IChatSourceGateway, ISourceRatingReader } from './chatSource.gateway';
import {
  CHAT_SOURCES_MAX,
  IChatMessageSourceData,
  IChatSourceEntry,
  IChatSourceInput,
  IChatSourceViewer,
  ICreateChatMessageSource,
  IRecordSourcesInput,
  isWebUrl,
} from './chatSource.types';

/**
 * The citation record (CLEAN-138). `record` runs when the runtime's `sources`
 * event arrives and before it is relayed, so the first frame a browser sees
 * already has a persisted twin. `forMessages` is what every history view and
 * the relayed frame show; `isCitedTo` is the one question the reader-facing
 * document and rating routes ask before doing anything.
 *
 * The bridle channel for a conversation is `bridle:<clientId>` on the
 * runtime's side; the same key is stored so the row joins ChatSession when
 * the index row exists. No FK: the index can arrive later, and deleting a
 * conversation must not erase what was cited.
 */
@Injectable()
export class ChatSourceService {
  private readonly logger = new Logger(ChatSourceService.name);

  constructor(
    private readonly gateway: IChatSourceGateway,
    private readonly sources: ISourceGateway,
    private readonly knowledges: IKnowledgeGateway,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
    @Inject(forwardRef(() => ITemplateGateway))
    private readonly templates: ITemplateGateway,
    @Optional() private readonly ratings?: ISourceRatingReader,
  ) {}

  async record(input: IRecordSourcesInput): Promise<void> {
    if (input.sources.length > CHAT_SOURCES_MAX) {
      throw new Error(
        `sources event for ${input.messageId} carries ${input.sources.length} entries; the limit is ${CHAT_SOURCES_MAX}`,
      );
    }
    // What the agent may cite is what it may read. `query_knowledge` already
    // refuses to search an unbound base; checking again here means a runtime
    // speaking for agent A cannot make a document of base B openable by
    // naming it in an event. The link is dropped, the name is kept.
    const bound = new Set(
      await boundKnowledgeIds(input.agentId, this.agents, this.templates),
    );
    const rows: ICreateChatMessageSource[] = [];
    for (let i = 0; i < input.sources.length; i++) {
      rows.push(await this.toRow(input, input.sources[i], i + 1, bound));
    }
    await this.gateway.upsertMany(rows);
  }

  /**
   * Entries per message id, in citation order. Messages without sources are
   * absent from the map — most messages, so the common case costs one query
   * for the rows and nothing more.
   */
  async forMessages(
    messageIds: string[],
    viewer: IChatSourceViewer,
  ): Promise<Map<string, IChatSourceEntry[]>> {
    const out = new Map<string, IChatSourceEntry[]>();
    if (messageIds.length === 0) return out;
    const rows = await this.gateway.findByMessageIds(messageIds);
    if (rows.length === 0) return out;

    const knowledgeIds = unique(
      rows.map((r) => r.knowledgeId).filter((id): id is string => !!id),
    );
    const sourceIds = unique(
      rows.map((r) => r.sourceId).filter((id): id is string => !!id),
    );
    const existing = await this.existingSources(sourceIds);
    // Openness follows the base the Source row belongs to today, not the id
    // stored when it was cited — the row is a record, the Source is the fact.
    const liveKnowledgeIds = unique([...knowledgeIds, ...existing.values()]);
    const [bases, mine] = await Promise.all([
      liveKnowledgeIds.length
        ? this.knowledges.findExistingByIds(liveKnowledgeIds)
        : Promise.resolve([]),
      this.ratings
        ? this.ratings.mine(
            unique(rows.map((r) => r.messageId)),
            viewer.clientId,
          )
        : Promise.resolve({} as Record<string, 1 | -1>),
    ]);
    const openBases = new Set(
      bases.filter((b) => b.readerAccess === 'open').map((b) => b.id),
    );

    for (const r of rows) {
      const entry: IChatSourceEntry = {
        n: r.n,
        kind: r.kind,
        name: r.name,
        canOpen: false,
      };
      if (r.kind === 'web') {
        if (r.url) entry.url = r.url;
        entry.canOpen = isWebUrl(r.url);
      } else {
        entry.knowledgeName = r.knowledgeName;
        // Policy is read now, not when the row was written: closing a base
        // must close every answer that cited it (FR-016c). A deleted source
        // stays named but never opens (FR-017).
        const liveBase = r.sourceId ? existing.get(r.sourceId) : undefined;
        const baseOpen =
          viewer.isAdmin || (!!liveBase && openBases.has(liveBase));
        entry.canOpen = liveBase !== undefined && baseOpen;
        const rating = r.sourceId
          ? mine[`${r.messageId}:${r.sourceId}`]
          : undefined;
        if (rating) entry.myRating = rating;
      }
      const list = out.get(r.messageId) ?? [];
      list.push(entry);
      out.set(r.messageId, list);
    }
    return out;
  }

  /**
   * `forMessages` applied to a page of transcript messages: assistant
   * messages gain their list, everything else passes through. A failed
   * lookup leaves the page without lists rather than without messages.
   */
  async attach<T extends { id: string; role: string }>(
    messages: T[],
    viewer: IChatSourceViewer,
  ): Promise<(T & { sources?: IChatSourceEntry[] })[]> {
    try {
      const byMessage = await this.forMessages(
        messages.filter((m) => m.role === 'assistant').map((m) => m.id),
        viewer,
      );
      if (byMessage.size === 0) return messages;
      return messages.map((m) => {
        const sources = byMessage.get(m.id);
        return sources ? { ...m, sources } : m;
      });
    } catch (err) {
      this.logger.warn(
        `Sources lookup failed for a history page: ${(err as Error).message}`,
      );
      return messages;
    }
  }

  /** The row when `(agentId, messageId, n)` was cited to this viewer; null otherwise. */
  async isCitedTo(
    agentId: string,
    messageId: string,
    n: number,
    viewer: IChatSourceViewer,
  ): Promise<IChatMessageSourceData | null> {
    const row = await this.gateway.findOne(agentId, messageId, n);
    if (!row) return null;
    if (!viewer.isAdmin && row.clientId !== viewer.clientId) return null;
    return row;
  }

  private async toRow(
    input: IRecordSourcesInput,
    source: IChatSourceInput,
    n: number,
    bound: Set<string>,
  ): Promise<ICreateChatMessageSource> {
    const base = {
      agentId: input.agentId,
      clientId: input.clientId,
      sessionKey: `bridle:${input.clientId}`,
      messageId: input.messageId,
      n,
    };
    if (source.kind === 'web') {
      if (!isWebUrl(source.url)) {
        throw new Error(
          `sources event for ${input.messageId}: entry ${n} is not a web address`,
        );
      }
      return {
        ...base,
        kind: 'web',
        sourceId: null,
        knowledgeId: null,
        knowledgeName: null,
        name: source.title?.trim() || readableAddress(source.url),
        url: source.url,
      };
    }
    if (!source.id || !source.name) {
      throw new Error(
        `sources event for ${input.messageId}: entry ${n} names no knowledge source`,
      );
    }
    // The runtime names a source it saw a moment ago; it may already be gone.
    // Keep the name, drop the link — the answer still has to read. The base
    // is taken from the Source row, never from the event: a runtime naming
    // an open base next to a closed base's document would otherwise open it.
    let found = await this.sources.findById(source.id);
    if (!found) {
      this.logger.warn(
        `sources event for ${input.messageId} cites source ${source.id} which no longer exists`,
      );
    } else if (!bound.has(found.knowledgeId)) {
      this.logger.warn(
        `sources event for ${input.messageId} from agent=${input.agentId} cites source ${source.id} of knowledge=${found.knowledgeId}, which is not bound to that agent; linking refused`,
      );
      found = null;
    }
    const knowledgeId = found?.knowledgeId ?? source.knowledgeId ?? null;
    const knowledgeName = knowledgeId
      ? ((await this.knowledges.findExistingByIds([knowledgeId]))[0]?.name ??
        source.knowledgeName ??
        null)
      : null;
    return {
      ...base,
      kind: 'knowledge',
      sourceId: found ? source.id : null,
      knowledgeId,
      knowledgeName,
      name: source.name,
      url: null,
    };
  }

  /** Source id → the knowledge id it belongs to, for the sources that still exist. */
  private async existingSources(ids: string[]): Promise<Map<string, string>> {
    const found = await Promise.all(
      ids.map(async (id) => [id, await this.sources.findById(id)] as const),
    );
    const out = new Map<string, string>();
    for (const [id, source] of found) {
      if (source) out.set(id, source.knowledgeId);
    }
    return out;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** `https://docs.example.com/a/b?x=1` → `docs.example.com/a/b` — a title for
 * a page that had none, readable in a list and never widening it. */
export function readableAddress(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}
