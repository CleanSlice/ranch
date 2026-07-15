import { ChatSyncService } from './chatSync.service';
import { IChatReconcileInput, IChatSessionData } from './chat.types';
import { IChatGateway } from './chat.gateway';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { IFileGateway, IFileChunk, TranscriptReaderService } from '#/agent/file/domain';

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function fileStub(
  files: { path: string; size: number }[],
  contents: Record<string, string>,
): IFileGateway {
  return {
    list: async () => files.map((f) => ({ path: f.path, size: f.size, updatedAt: new Date(0) })),
    readRange: async (_a: string, path: string): Promise<IFileChunk> => {
      const content = contents[path] ?? '';
      const size = Buffer.byteLength(content);
      return { path, content, size, totalSize: size, offset: 0, nextOffset: null, hasMore: false, updatedAt: new Date(0) };
    },
  } as unknown as IFileGateway;
}

function chatsStub(existing: Partial<IChatSessionData>[]) {
  const upserts: IChatReconcileInput[] = [];
  const chats = {
    list: async () => ({ items: existing as IChatSessionData[], total: existing.length }),
    reconcileUpsert: async (i: IChatReconcileInput) => {
      upserts.push(i);
      return i as unknown as IChatSessionData;
    },
    findById: async () => null,
  } as unknown as IChatGateway;
  return { chats, upserts };
}

const agentsStub = { findAll: async () => [{ id: 'agent-1' }] } as unknown as IAgentGateway;

describe('ChatSyncService.syncAll', () => {
  it('indexes session files, skips unchanged (by size) and non-session files, and parses names', async () => {
    const bridleLive = jsonl(
      { id: 'u1', type: 'user', ts: 1, data: { text: 'hi' } },
      { id: 'p', type: 'assistant', ts: 2, data: { text: 'part' } },
      { id: 'c', type: 'user', ts: 3, data: { text: 'Your response was cut off. Continue' } },
      { id: 'a1', type: 'assistant', ts: 4, data: { text: 'part full' } },
    );
    const archived = jsonl({ id: 'x', type: 'user', ts: 9, data: { text: 'old chat' } });

    const files = [
      { path: 'data/sessions/bridle:admin.jsonl', size: 111 },
      { path: 'data/sessions/telegram:555.jsonl', size: 50 }, // unchanged → skipped
      { path: 'data/sessions/bridle:admin.2026-01-01T00-00-00.archived.jsonl', size: 22 },
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
});
