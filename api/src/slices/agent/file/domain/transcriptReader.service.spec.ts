import { TranscriptReaderService, TranscriptMessage } from './transcriptReader.service';
import { IFileGateway } from './file.gateway';
import { IFileChunk } from './file.types';

// Minimal IFileGateway stub: readRange returns the whole fixture in one chunk.
function fileStub(content: string): IFileGateway {
  const size = Buffer.byteLength(content);
  return {
    readRange: async (
      _agentId: string,
      path: string,
    ): Promise<IFileChunk> => ({
      path,
      content,
      size,
      totalSize: size,
      offset: 0,
      nextOffset: null,
      hasMore: false,
      updatedAt: new Date(0),
    }),
  } as unknown as IFileGateway;
}

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

const reader = (content: string) => new TranscriptReaderService(fileStub(content));
const roles = (m: TranscriptMessage[]) => m.map((x) => x.role);
const texts = (m: TranscriptMessage[]) => m.map((x) => x.text);

describe('TranscriptReaderService', () => {
  it('returns user+assistant by default, sorted by ts', async () => {
    const content = jsonl(
      { id: 'b', type: 'assistant', ts: 2, data: { text: 'hi there' } },
      { id: 'a', type: 'user', ts: 1, data: { text: 'hello' } },
      { id: 'c', type: 'tool_call', ts: 3, data: { name: 'exec' } },
    );
    const out = await reader(content).read('agent', 'p');
    expect(roles(out)).toEqual(['user', 'assistant']); // tool_call hidden by default
    expect(texts(out)).toEqual(['hello', 'hi there']);
  });

  it('surfaces summary events when requested', async () => {
    const content = jsonl(
      { id: 's', type: 'summary', ts: 1, data: { text: '[ARCHIVED CONTEXT] gist [END]' } },
      { id: 'u', type: 'user', ts: 2, data: { text: 'and then?' } },
    );
    const withSummary = await reader(content).read('agent', 'p', {
      types: ['user', 'assistant', 'summary'],
    });
    expect(roles(withSummary)).toEqual(['summary', 'user']);

    const withoutSummary = await reader(content).read('agent', 'p');
    expect(roles(withoutSummary)).toEqual(['user']); // silent gap unless summary requested
  });

  it('drops the max_tokens duplicate: partial assistant + continuation prompt (legacy text)', async () => {
    const content = jsonl(
      { id: 'u', type: 'user', ts: 1, data: { text: 'write a poem' } },
      { id: 'p', type: 'assistant', ts: 2, data: { text: 'Roses are red,' } }, // partial
      { id: 'c', type: 'user', ts: 3, data: { text: 'Your response was cut off. Continue…' } },
      { id: 'f', type: 'assistant', ts: 4, data: { text: 'Roses are red, violets are blue.' } },
    );
    const out = await reader(content).read('agent', 'p');
    expect(texts(out)).toEqual(['write a poem', 'Roses are red, violets are blue.']);
  });

  it('drops synthetic events tagged data.transient (new data)', async () => {
    const content = jsonl(
      { id: 'u', type: 'user', ts: 1, data: { text: 'q' } },
      { id: 'p', type: 'assistant', ts: 2, data: { text: 'chunk', transient: true } },
      { id: 'c', type: 'user', ts: 3, data: { text: 'continue', transient: true } },
      { id: 'f', type: 'assistant', ts: 4, data: { text: 'full answer' } },
    );
    const out = await reader(content).read('agent', 'p');
    expect(texts(out)).toEqual(['q', 'full answer']);
  });

  it('filterTransient=false preserves raw order byte-for-byte (bridle widget parity)', async () => {
    const content = jsonl(
      { id: 'u', type: 'user', ts: 1, data: { text: 'q' } },
      { id: 'p', type: 'assistant', ts: 2, data: { text: 'part' } },
      { id: 'c', type: 'user', ts: 3, data: { text: 'Your response was cut off. Continue…' } },
      { id: 'f', type: 'assistant', ts: 4, data: { text: 'part full' } },
    );
    const out = await reader(content).read('agent', 'p', { filterTransient: false });
    expect(out).toHaveLength(4); // nothing filtered
  });

  it('paginates tail-first via page()', () => {
    const msgs: TranscriptMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      text: `#${i}`,
      ts: i,
    }));
    const latest = TranscriptReaderService.page(msgs, undefined, 2);
    expect(texts(latest.messages)).toEqual(['#3', '#4']);
    expect(latest.hasMore).toBe(true);

    const older = TranscriptReaderService.page(msgs, latest.nextCursor!, 2);
    expect(texts(older.messages)).toEqual(['#1', '#2']);
    expect(older.hasMore).toBe(true);

    const oldest = TranscriptReaderService.page(msgs, older.nextCursor!, 2);
    expect(texts(oldest.messages)).toEqual(['#0']);
    expect(oldest.hasMore).toBe(false);
    expect(oldest.nextCursor).toBeNull();
  });
});
