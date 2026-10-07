import { Socket } from 'socket.io';
import { BridleAgentWsHandler, readSourcesEvent } from './bridleAgentWs.handler';
import type { IBridleOutgoingEvent } from '../domain';
import type { IChatSourceEntry, IRecordSourcesInput } from '#/chat/domain';

/**
 * The `sources` socket event (CLEAN-138): recorded, then relayed with the
 * reader-facing entries; a malformed frame is dropped and nothing is written.
 * What the rows look like is chatSource.service.spec.ts's business.
 */

function makeHandler(entries: IChatSourceEntry[] = []) {
  const routed: IBridleOutgoingEvent[] = [];
  const recorded: IRecordSourcesInput[] = [];
  const hub = {
    isAgentSocket: () => true,
    handleAgentEvent: (_agentId: string, data: IBridleOutgoingEvent) => {
      routed.push(data);
    },
  };
  const chatSources = {
    record: jest.fn(async (input: IRecordSourcesInput) => {
      recorded.push(input);
    }),
    forMessages: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, entries]))),
  };
  const handler = new BridleAgentWsHandler(
    hub as never,
    { get: () => 'key' } as never,
    {} as never,
    {} as never,
    chatSources as never,
  );
  const client = { data: { agentId: 'agent-1', send: () => undefined } } as unknown as Socket;
  return { handler, client, routed, recorded, chatSources };
}

const frame = {
  type: 'sources',
  clientId: 'user-1',
  messageId: 'm1',
  text: 'Answer [^1].',
  sources: [
    { kind: 'knowledge', id: 's1', name: 'Doc', knowledgeId: 'k1', knowledgeName: 'Legal' },
  ],
  ts: 5,
};

describe('agent socket — sources event', () => {
  it('records the citations and relays the reader-facing entries with the same ids', async () => {
    const entries: IChatSourceEntry[] = [
      { n: 1, kind: 'knowledge', name: 'Doc', knowledgeName: 'Legal', canOpen: false },
    ];
    const { handler, client, routed, recorded } = makeHandler(entries);
    await handler.handleSources(client, frame);

    expect(recorded).toEqual([
      { agentId: 'agent-1', clientId: 'user-1', messageId: 'm1', text: 'Answer [^1].', sources: frame.sources, ts: 5 },
    ]);
    expect(routed).toEqual([
      { type: 'sources', clientId: 'user-1', messageId: 'm1', text: 'Answer [^1].', sources: entries, ts: 5 },
    ]);
    // The runtime's ids stay behind.
    expect(JSON.stringify(routed)).not.toContain('"id":"s1"');
  });

  it('drops a malformed frame without writing or relaying', async () => {
    const { handler, client, routed, recorded } = makeHandler();
    await handler.handleSources(client, { ...frame, sources: [] });
    await handler.handleSources(client, { ...frame, messageId: 7 });
    await handler.handleSources(client, { ...frame, sources: [{ kind: 'web' }] });
    expect(recorded).toHaveLength(0);
    expect(routed).toHaveLength(0);
  });

  it('keeps the bubble when recording fails — logged, not relayed', async () => {
    const { handler, client, routed, chatSources } = makeHandler();
    chatSources.record.mockRejectedValueOnce(new Error('not a web address'));
    await handler.handleSources(client, frame);
    expect(routed).toHaveLength(0);
  });
});

describe('readSourcesEvent', () => {
  it('accepts both kinds and defaults what the runtime may omit', () => {
    const read = readSourcesEvent({
      clientId: 'c',
      messageId: 'm',
      text: 't',
      sources: [
        { kind: 'web', url: 'https://x.io/a' },
        { kind: 'knowledge', id: 's', name: 'n' },
      ],
    });
    expect(read?.sources).toEqual([
      { kind: 'web', url: 'https://x.io/a', title: null },
      { kind: 'knowledge', id: 's', name: 'n', knowledgeId: '', knowledgeName: null },
    ]);
    expect(typeof read?.ts).toBe('number');
  });

  it('refuses an unknown kind, a missing text, or more than fifty entries', () => {
    expect(readSourcesEvent({ clientId: 'c', messageId: 'm', text: 't', sources: [{ kind: 'pdf' }] })).toBeNull();
    expect(readSourcesEvent({ clientId: 'c', messageId: 'm', sources: [{ kind: 'web', url: 'https://x' }] })).toBeNull();
    const many = Array.from({ length: 51 }, (_, i) => ({ kind: 'web', url: `https://x/${i}` }));
    expect(readSourcesEvent({ clientId: 'c', messageId: 'm', text: 't', sources: many })).toBeNull();
  });
});
