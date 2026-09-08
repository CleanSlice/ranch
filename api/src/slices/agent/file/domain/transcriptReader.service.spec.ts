import { TranscriptReaderService } from './transcriptReader.service';
import type { IFileGateway } from './file.gateway';
import type { IFileChunk } from './file.types';

const ID = '0b53c9a4-7f4e-4bb1-a6b1-6a1f2f9c8f21';
const PATH = 'data/sessions/bridle:admin.jsonl';

/** Serves one JSONL string in a single chunk. */
function fakeFiles(content: string): IFileGateway {
  return {
    readRange: async (): Promise<IFileChunk> => ({
      path: PATH,
      content,
      size: Buffer.byteLength(content),
      totalSize: Buffer.byteLength(content),
      offset: 0,
      nextOffset: null,
      hasMore: false,
      updatedAt: new Date(0),
    }),
  } as unknown as IFileGateway;
}

function line(evt: Record<string, unknown>): string {
  return JSON.stringify(evt);
}

const NEW_BLOCK = `[Attached file: a.xlsx — id: ${ID}]\n\`\`\`\nR1: A=1\n\`\`\``;
const LEGACY_BLOCK = '[Attached file: a.txt]\n```\nold\n```';
const ATTACHMENTS = [
  {
    id: ID,
    name: 'a.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 10,
    kind: 'binary',
  },
];

describe('TranscriptReaderService — typed text vs agent-facing text', () => {
  it('returns the typed text and keeps the full string as agentText', async () => {
    const full = `распарси\n\n${NEW_BLOCK}`;
    const jsonl = [
      line({ id: 'u1', type: 'user', ts: 1, data: { text: full, attachments: ATTACHMENTS } }),
      line({ id: 'a1', type: 'assistant', ts: 2, data: { text: 'ok' } }),
    ].join('\n');

    const out = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'u1', role: 'user', text: 'распарси', agentText: full });
    expect(out[0].attachments).toHaveLength(1);
    expect(out[1]).toEqual({ id: 'a1', role: 'assistant', text: 'ok', ts: 2 });
    expect('agentText' in out[1]).toBe(false);
  });

  it('splits a legacy block persisted before ids and metadata existed', async () => {
    const full = `hi\n\n${LEGACY_BLOCK}`;
    const jsonl = line({ id: 'u1', type: 'user', ts: 1, data: { text: full } });

    const [msg] = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(msg.text).toBe('hi');
    expect(msg.agentText).toBe(full);
    expect(msg.attachments).toBeUndefined();
  });

  it('keeps an attachment-only message with an empty typed text', async () => {
    const jsonl = line({
      id: 'u1',
      type: 'user',
      ts: 1,
      data: { text: NEW_BLOCK, attachments: ATTACHMENTS },
    });

    const [msg] = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(msg).toBeDefined();
    expect(msg.text).toBe('');
    expect(msg.agentText).toBe(NEW_BLOCK);
    expect(msg.attachments).toHaveLength(1);
  });

  it('keeps a legacy attachment-only message even without metadata', async () => {
    const jsonl = line({ id: 'u1', type: 'user', ts: 1, data: { text: LEGACY_BLOCK } });

    const out = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('');
    expect(out[0].agentText).toBe(LEGACY_BLOCK);
  });

  it('leaves a plain user message alone and sets no agentText', async () => {
    const jsonl = line({ id: 'u1', type: 'user', ts: 1, data: { text: 'plain' } });

    const [msg] = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(msg.text).toBe('plain');
    expect('agentText' in msg).toBe(false);
  });

  it('does not split when the block does not parse (truncated tail)', async () => {
    const broken = `hi\n\n[Attached file: a.txt — id: ${ID}]\n\`\`\`\nno closing fence`;
    const jsonl = line({ id: 'u1', type: 'user', ts: 1, data: { text: broken } });

    const [msg] = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(msg.text).toBe(broken);
    expect('agentText' in msg).toBe(false);
  });

  it('never splits assistant text even if it quotes the marker', async () => {
    const quoted = `I saw:\n\n${NEW_BLOCK}`;
    const jsonl = line({ id: 'a1', type: 'assistant', ts: 1, data: { text: quoted } });

    const [msg] = await new TranscriptReaderService(fakeFiles(jsonl)).read('ag', PATH);

    expect(msg.text).toBe(quoted);
    expect('agentText' in msg).toBe(false);
  });
});
