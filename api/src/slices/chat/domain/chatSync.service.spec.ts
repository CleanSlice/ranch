import { ChatSyncService } from './chatSync.service';
import { IChatReconcileInput, IChatSessionData } from './chat.types';
import { IChatGateway } from './chat.gateway';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import {
  IFileGateway,
  IFileChunk,
  TranscriptReaderService,
} from '#/agent/file/domain';

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function fileStub(
  files: { path: string; size: number }[],
  contents: Record<string, string>,
): IFileGateway {
  return {
    list: async () =>
      files.map((f) => ({
        path: f.path,
        size: f.size,
        updatedAt: new Date(0),
        kind: 'text',
        editable: true,
      })),
    readRange: async (_a: string, path: string): Promise<IFileChunk> => {
      const content = contents[path] ?? '';
      const size = Buffer.byteLength(content);
      return {
        path,
        content,
        size,
        totalSize: size,
        offset: 0,
        nextOffset: null,
        hasMore: false,
        updatedAt: new Date(0),
        kind: 'text',
        editable: true,
      };
    },
  } as unknown as IFileGateway;
}

function chatsStub(existing: Partial<IChatSessionData>[]) {
  const upserts: IChatReconcileInput[] = [];
  const chats = {
    list: async () => ({
      items: existing as IChatSessionData[],
      total: existing.length,
    }),
    reconcileUpsert: async (i: IChatReconcileInput) => {
      upserts.push(i);
      return i as unknown as IChatSessionData;
    },
    findById: async () => null,
  } as unknown as IChatGateway;
  return { chats, upserts };
}

const agentsStub = {
  findAll: async () => [{ id: 'agent-1' }],
} as unknown as IAgentGateway;

describe('ChatSyncService.syncAll', () => {
  it('indexes session files, skips unchanged (by size) and non-session files, and parses names', async () => {
    const bridleLive = jsonl(
      { id: 'u1', type: 'user', ts: 1, data: { text: 'hi' } },
      { id: 'p', type: 'assistant', ts: 2, data: { text: 'part' } },
      {
        id: 'c',
        type: 'user',
        ts: 3,
        data: { text: 'Your response was cut off. Continue' },
      },
      { id: 'a1', type: 'assistant', ts: 4, data: { text: 'part full' } },
    );
    const archived = jsonl({
      id: 'x',
      type: 'user',
      ts: 9,
      data: { text: 'old chat' },
    });

    const files = [
      { path: 'data/sessions/bridle:admin.jsonl', size: 111 },
      { path: 'data/sessions/telegram:555.jsonl', size: 50 }, // unchanged → skipped
      {
        path: 'data/sessions/bridle:admin.2026-01-01T00-00-00.archived.jsonl',
        size: 22,
      },
      { path: 'SOUL.md', size: 10 }, // not a session file
    ];
    const contents = {
      'data/sessions/bridle:admin.jsonl': bridleLive,
      'data/sessions/bridle:admin.2026-01-01T00-00-00.archived.jsonl': archived,
    };

    const files_ = fileStub(files, contents);
    const reader = new TranscriptReaderService(files_);
    const { chats, upserts } = chatsStub([
      { sessionKey: 'telegram:555', lastIndexedSize: 50 },
    ]);

    const svc = new ChatSyncService(files_, reader, chats, agentsStub);
    const result = await svc.syncAll('agent-1');

    expect(result.scannedFiles).toBe(3); // SOUL.md excluded
    expect(result.skipped).toBe(1); // telegram:555 unchanged
    expect(result.upserted).toBe(2);

    const live = upserts.find((u) => u.sessionKey === 'bridle:admin')!;
    expect(live.channel).toBe('bridle');
    expect(live.externalUserId).toBe('admin');
    expect(live.archived).toBe(false);
    // hygiene applied: partial + continuation dropped → 1 user + 1 assistant
    expect(live.messageCount).toBe(2);
    expect(live.userMessageCount).toBe(1);
    expect(live.preview).toBe('part full');
    expect(live.lastRole).toBe('assistant');

    const arch = upserts.find((u) => u.sessionKey.endsWith('.archived'))!;
    expect(arch.archived).toBe(true);
    expect(arch.channel).toBe('bridle');
    expect(arch.externalUserId).toBe('admin');
  });

  /**
   * A visitor closed a conversation with "New chat" (CLEAN-136). The route
   * moved the index row to the archived key at once; reconciliation later
   * meets the archived file under that same key — so the closed conversation
   * stays ONE row, the visitor's, and is not indexed a second time.
   */
  describe('a conversation a share visitor closed', () => {
    const ARCHIVED_KEY = 'bridle:share-ab12.2026-10-02T09-14-03-512Z.archived';
    const ARCHIVED_PATH = `data/sessions/${ARCHIVED_KEY}.jsonl`;
    const closed = jsonl(
      { id: 'u1', type: 'user', ts: 1, data: { text: 'what are your hours?' } },
      { id: 'a1', type: 'assistant', ts: 2, data: { text: '9 to 5' } },
    );

    it('is indexed as the visitor’s own closed conversation', async () => {
      const files_ = fileStub([{ path: ARCHIVED_PATH, size: 80 }], {
        [ARCHIVED_PATH]: closed,
      });
      const { chats, upserts } = chatsStub([]);

      const svc = new ChatSyncService(
        files_,
        new TranscriptReaderService(files_),
        chats,
        agentsStub,
      );
      await svc.syncAll('agent-1');

      expect(upserts).toHaveLength(1);
      expect(upserts[0].sessionKey).toBe(ARCHIVED_KEY);
      expect(upserts[0].channel).toBe('bridle');
      expect(upserts[0].externalUserId).toBe('share-ab12');
      expect(upserts[0].archived).toBe(true);
      expect(upserts[0].messageCount).toBe(2);
    });

    it('is left alone when the row the route moved already describes the file', async () => {
      const files_ = fileStub([{ path: ARCHIVED_PATH, size: 80 }], {
        [ARCHIVED_PATH]: closed,
      });
      const { chats, upserts } = chatsStub([
        { sessionKey: ARCHIVED_KEY, lastIndexedSize: 80 },
      ]);

      const svc = new ChatSyncService(
        files_,
        new TranscriptReaderService(files_),
        chats,
        agentsStub,
      );
      const result = await svc.syncAll('agent-1');

      expect(result.skipped).toBe(1);
      expect(upserts).toHaveLength(0);
    });

    it('refreshes that one row, under the same key, when the file is larger than what was indexed', async () => {
      // The live row was last indexed before the final exchange was pushed.
      const files_ = fileStub([{ path: ARCHIVED_PATH, size: 80 }], {
        [ARCHIVED_PATH]: closed,
      });
      const { chats, upserts } = chatsStub([
        { sessionKey: ARCHIVED_KEY, lastIndexedSize: 40 },
      ]);

      const svc = new ChatSyncService(
        files_,
        new TranscriptReaderService(files_),
        chats,
        agentsStub,
      );
      await svc.syncAll('agent-1');

      expect(upserts.map((u) => u.sessionKey)).toEqual([ARCHIVED_KEY]);
    });
  });
});

/**
 * `POST /me/chats/sync` (CLEAN-232): a person's own conversations, in the
 * agents they already have one with. It used to walk every agent on the
 * ranch for whoever asked and report how many there are.
 */
describe('ChatSyncService.syncForExternalUser', () => {
  const MINE = 'data/sessions/bridle:user-1.jsonl';
  const THEIRS = 'data/sessions/bridle:user-2.jsonl';
  const transcript = jsonl(
    { id: 'u1', type: 'user', ts: 1, data: { text: 'hello' } },
    { id: 'a1', type: 'assistant', ts: 2, data: { text: 'hi' } },
  );

  function bed(indexed: Partial<IChatSessionData>[]) {
    const listed: string[] = [];
    const filters: Record<string, unknown>[] = [];
    const files_ = {
      ...fileStub(
        [
          { path: MINE, size: 70 },
          { path: THEIRS, size: 70 },
          { path: 'data/sessions/telegram:user-1.jsonl', size: 70 },
        ],
        { [MINE]: transcript, [THEIRS]: transcript },
      ),
    } as IFileGateway;
    const list = files_.list.bind(files_);
    files_.list = async (agentId: string) => {
      listed.push(agentId);
      return list(agentId);
    };
    const upserts: IChatReconcileInput[] = [];
    const chats = {
      list: async (filter: Record<string, unknown>) => {
        filters.push(filter);
        const items = indexed.filter(
          (s) =>
            (filter.agentId === undefined || s.agentId === filter.agentId) &&
            (filter.externalUserId === undefined ||
              s.externalUserId === filter.externalUserId) &&
            (filter.channel === undefined || s.channel === filter.channel),
        );
        return { items: items as IChatSessionData[], total: items.length };
      },
      reconcileUpsert: async (i: IChatReconcileInput) => {
        upserts.push(i);
        return i as unknown as IChatSessionData;
      },
    } as unknown as IChatGateway;
    const findAll = jest.fn(async () => [
      { id: 'agent-1' },
      { id: 'agent-2' },
      { id: 'agent-3' },
    ]);
    const svc = new ChatSyncService(
      files_,
      new TranscriptReaderService(files_),
      chats,
      { findAll } as unknown as IAgentGateway,
    );
    return { svc, listed, filters, upserts, findAll };
  }

  const session = (
    agentId: string,
    externalUserId: string,
    lastIndexedSize = 10,
  ): Partial<IChatSessionData> => ({
    agentId,
    channel: 'bridle',
    externalUserId,
    sessionKey: `bridle:${externalUserId}`,
    lastIndexedSize,
  });

  it('looks only at the agents this person has a conversation with, and never lists the ranch', async () => {
    const { svc, listed, upserts, findAll } = bed([
      session('agent-1', 'user-1'),
      session('agent-2', 'user-2'),
      session('agent-3', 'user-2'),
    ]);

    const result = await svc.syncForExternalUser('user-1');

    expect(findAll).not.toHaveBeenCalled();
    expect(listed).toEqual(['agent-1']);
    expect(result).toEqual({
      scannedAgents: 1,
      scannedFiles: 1,
      upserted: 1,
      skipped: 0,
    });
    expect(upserts.map((u) => u.sessionKey)).toEqual(['bridle:user-1']);
  });

  it('reads no row of the index that is not this person’s', async () => {
    const { svc, filters } = bed([
      session('agent-1', 'user-1'),
      session('agent-1', 'user-2'),
    ]);

    await svc.syncForExternalUser('user-1');

    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      expect(filter.channel).toBe('bridle');
      expect(filter.externalUserId).toBe('user-1');
      expect(filter.includeInternal).toBeUndefined();
    }
  });

  it('scans nothing and counts nothing for a person with no conversation', async () => {
    const { svc, listed, upserts } = bed([session('agent-2', 'user-2')]);

    const result = await svc.syncForExternalUser('user-1');

    expect(listed).toEqual([]);
    expect(upserts).toEqual([]);
    expect(result).toEqual({
      scannedAgents: 0,
      scannedFiles: 0,
      upserted: 0,
      skipped: 0,
    });
  });

  it('scans nothing when the agent named is not one of theirs', async () => {
    const { svc, listed } = bed([
      session('agent-1', 'user-1'),
      session('agent-2', 'user-2'),
    ]);

    const result = await svc.syncForExternalUser('user-1', 'agent-2');

    expect(listed).toEqual([]);
    expect(result.scannedAgents).toBe(0);
  });

  it('scans the one agent named when it is theirs, and skips a file that has not grown', async () => {
    const { svc, listed, upserts } = bed([
      session('agent-1', 'user-1', 70),
      session('agent-2', 'user-1'),
    ]);

    const result = await svc.syncForExternalUser('user-1', 'agent-1');

    expect(listed).toEqual(['agent-1']);
    expect(result).toEqual({
      scannedAgents: 1,
      scannedFiles: 1,
      upserted: 0,
      skipped: 1,
    });
    expect(upserts).toEqual([]);
  });
});

/**
 * `POST /chats/sync` and `sync_chats` with no agent named walk every agent.
 * For a caller whose access lists hide some, the walk and the counts are of
 * the agents they reach (CLEAN-231): a hidden agent's files are not listed,
 * and the answer does not say how many agents there are.
 */
describe('ChatSyncService.syncAll for a caller with a reach', () => {
  const threeAgents = {
    findAll: async () => [{ id: 'agent-1' }, { id: 'agent-2' }, { id: 'agent-3' }],
  } as unknown as IAgentGateway;

  function service() {
    const listed: string[] = [];
    const files = {
      list: async (agentId: string) => {
        listed.push(agentId);
        return [];
      },
    } as unknown as IFileGateway;
    const { chats } = chatsStub([]);
    const svc = new ChatSyncService(
      files,
      new TranscriptReaderService(files),
      chats,
      threeAgents,
    );
    return { svc, listed };
  }

  const reach = { has: (id: string) => id !== 'agent-2' };

  it('skips an unreached agent when walking and when counting', async () => {
    const { svc, listed } = service();
    const result = await svc.syncAll(undefined, reach);
    expect(listed).toEqual(['agent-1', 'agent-3']);
    expect(result.scannedAgents).toBe(2);
  });

  it('scans nothing for an unreached agent named outright', async () => {
    const { svc, listed } = service();
    const result = await svc.syncAll('agent-2', reach);
    expect(listed).toEqual([]);
    expect(result.scannedAgents).toBe(0);
  });

  it('walks every agent when no reach is given: the service’s own run', async () => {
    const { svc, listed } = service();
    const result = await svc.syncAll();
    expect(listed).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(result.scannedAgents).toBe(3);
  });
});
