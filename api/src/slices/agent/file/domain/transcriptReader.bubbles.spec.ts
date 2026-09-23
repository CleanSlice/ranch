import { TranscriptReaderService } from './transcriptReader.service';
import type { IFileGateway } from './file.gateway';
import type { IFileChunk } from './file.types';

const PATH = 'data/sessions/bridle:admin.jsonl';

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
      kind: 'text',
      editable: true,
    }),
  } as unknown as IFileGateway;
}

const read = (events: Array<Record<string, unknown>>) =>
  new TranscriptReaderService(
    fakeFiles(events.map((e) => JSON.stringify(e)).join('\n')),
  ).read('agent-1', PATH);

/**
 * A streamed turn is watched as several bubbles and stored as one event. The
 * replay used to show that event's whole text — "Проверю:Ха! Работает!" — in
 * a single bubble (CLEAN-102). The runtime now records the bubbles on the
 * event; the reader plays those back.
 */
describe('TranscriptReaderService — bubbles of one turn', () => {
  const question = {
    id: 'q1',
    type: 'user',
    ts: 1000,
    data: { text: 'работает?' },
  };

  it('replays the bubbles the person saw, under their wire ids', async () => {
    const messages = await read([
      question,
      {
        id: 'turn-1',
        type: 'assistant',
        ts: 5000,
        data: {
          text: 'Проверю:Ха! Работает!',
          messages: [
            { id: 'wire-1', text: 'Проверю:', ts: 2000 },
            { id: 'wire-2', text: 'Ха! Работает!', ts: 4000 },
          ],
        },
      },
    ]);

    expect(messages.map((m) => [m.id, m.role, m.text])).toEqual([
      ['q1', 'user', 'работает?'],
      ['wire-1', 'assistant', 'Проверю:'],
      ['wire-2', 'assistant', 'Ха! Работает!'],
    ]);
  });

  it('keeps showing turns stored before bubbles were recorded', async () => {
    const messages = await read([
      question,
      { id: 'turn-1', type: 'assistant', ts: 5000, data: { text: 'Да.' } },
    ]);

    expect(messages.map((m) => [m.id, m.text])).toEqual([
      ['q1', 'работает?'],
      ['turn-1', 'Да.'],
    ]);
  });

  it('falls back to the whole text rather than replay only some of it', async () => {
    const messages = await read([
      {
        id: 'turn-1',
        type: 'assistant',
        ts: 5000,
        data: {
          text: 'Проверю:Ха! Работает!',
          messages: [
            { id: 'wire-1', text: 'Проверю:', ts: 2000 },
            { id: 'wire-2', text: 'Ха! Работает!' },
          ],
        },
      },
    ]);

    expect(messages.map((m) => [m.id, m.text])).toEqual([
      ['turn-1', 'Проверю:Ха! Работает!'],
    ]);
  });

  it('keeps the order of the file for messages written in the same millisecond', async () => {
    const messages = await read([
      { id: 'a', type: 'user', ts: 1000, data: { text: 'first' } },
      { id: 'b', type: 'assistant', ts: 1000, data: { text: 'second' } },
      { id: 'c', type: 'user', ts: 1000, data: { text: 'third' } },
    ]);

    expect(messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
