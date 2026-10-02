import { BridleGateway } from './bridle.gateway';

type Event = Record<string, unknown>;

function collector(into: Event[]) {
  return (data: unknown) => {
    into.push(data as Event);
  };
}

/**
 * One identity, several places (CLEAN-102). Every Owner/Admin chats as
 * `admin`, and a conversation is routinely open in two tabs or in the admin
 * panel next to the console. With one slot per identity the last socket to
 * connect took every event and the tab that asked the question got nothing.
 */
describe('BridleGateway — several sockets on one conversation', () => {
  function twoTabs() {
    const gateway = new BridleGateway();
    const toAgent: Event[] = [];
    const tabA: Event[] = [];
    const tabB: Event[] = [];
    gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
    gateway.registerClient('admin', 'agent-1', 'tab-a', collector(tabA), true);
    gateway.registerClient('admin', 'agent-1', 'tab-b', collector(tabB), true);
    return { gateway, toAgent, tabA, tabB };
  }

  it('delivers the answer to the tab that asked, not only the newest one', () => {
    const { gateway, tabA, tabB } = twoTabs();

    gateway.handleAgentEvent('agent-1', {
      type: 'message',
      clientId: 'admin',
      text: 'hi',
      messageId: 'm1',
    });

    expect(tabA.map((e) => e.type)).toEqual(['message']);
    expect(tabB.map((e) => e.type)).toEqual(['message']);
    expect(tabA[0].seq).toBe(tabB[0].seq);
  });

  it('keeps the other tab receiving when one of them leaves', () => {
    const { gateway, tabA, tabB } = twoTabs();

    gateway.unregisterClient('admin', 'agent-1', 'tab-b');
    gateway.handleAgentEvent('agent-1', {
      type: 'message',
      clientId: 'admin',
      text: 'hi',
      messageId: 'm1',
    });

    expect(tabA).toHaveLength(1);
    expect(tabB).toHaveLength(0);
  });

  it('shows the question in the other tab, not in the one that sent it', () => {
    const { gateway, tabA, tabB } = twoTabs();

    gateway.sendToAgent('admin', 'agent-1', 'model text', [], undefined, {
      socketId: 'tab-a',
      clientMessageId: 'c1',
      displayText: 'typed text',
    });

    expect(tabA).toHaveLength(0);
    expect(tabB).toHaveLength(1);
    expect(tabB[0]).toMatchObject({
      type: 'user_message',
      messageId: 'c1',
      text: 'typed text',
    });
  });

  it('counts sockets, not identities, in health', () => {
    const { gateway } = twoTabs();

    expect(gateway.agentHealth('agent-1').browserClients).toBe(2);
  });
});

describe('BridleGateway — acknowledged sends', () => {
  function setup(agentOnline = true) {
    const gateway = new BridleGateway();
    const toAgent: Event[] = [];
    const toBrowser: Event[] = [];
    if (agentOnline) {
      gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
    }
    gateway.registerClient(
      'admin',
      'agent-1',
      'tab-a',
      collector(toBrowser),
      true,
    );
    return { gateway, toAgent, toBrowser };
  }
  const withAck = { socketId: 'tab-a', clientMessageId: 'c1', withAck: true };

  it('forwards the id the browser minted and reports it accepted', () => {
    const { gateway, toAgent } = setup();

    const result = gateway.sendToAgent(
      'admin',
      'agent-1',
      'hi',
      [],
      undefined,
      withAck,
    );

    expect(result).toMatchObject({ status: 'accepted', messageId: 'c1' });
    expect(toAgent).toHaveLength(1);
    expect(toAgent[0].messageId).toBe('c1');
  });

  it('hands a resend to the agent only once', () => {
    const { gateway, toAgent } = setup();

    gateway.sendToAgent('admin', 'agent-1', 'hi', [], undefined, withAck);
    const again = gateway.sendToAgent(
      'admin',
      'agent-1',
      'hi',
      [],
      undefined,
      withAck,
    );

    expect(again).toMatchObject({ status: 'accepted', duplicate: true });
    expect(toAgent).toHaveLength(1);
  });

  it('rejects instead of faking an agent reply when the caller wants an ack', () => {
    const { gateway, toBrowser } = setup(false);

    const result = gateway.sendToAgent(
      'admin',
      'agent-1',
      'hi',
      [],
      undefined,
      withAck,
    );

    expect(result).toEqual({ status: 'rejected', code: 'AGENT_OFFLINE' });
    expect(toBrowser).toHaveLength(0);
  });

  it('keeps the synthetic reply for callers that send no id (embed widget)', () => {
    const { gateway, toBrowser } = setup(false);

    const result = gateway.sendToAgent('admin', 'agent-1', 'hi', []);

    expect(result).toEqual({ status: 'rejected', code: 'AGENT_OFFLINE' });
    expect(toBrowser).toHaveLength(1);
    expect(toBrowser[0]).toMatchObject({ type: 'message' });
  });
});

/**
 * The answer that landed while the browser was reconnecting used to be gone
 * for good: the agent's log had it, the chat kept spinning (CLEAN-102).
 */
describe('BridleGateway — catching up after a reconnect', () => {
  function emit(
    gateway: BridleGateway,
    messageId: string,
    type: 'message' | 'stream' | 'stream_end' = 'message',
  ) {
    gateway.handleAgentEvent('agent-1', {
      type,
      clientId: 'admin',
      text: messageId,
      messageId,
    });
  }

  it('keeps events that arrive while no socket is connected', () => {
    const gateway = new BridleGateway();
    const first: Event[] = [];
    gateway.registerClient('admin', 'agent-1', 'tab-a', collector(first), true);
    emit(gateway, 'm1');
    const lastSeq = first[0].seq as number;

    gateway.unregisterClient('admin', 'agent-1', 'tab-a');
    emit(gateway, 'm2');

    const missed = gateway.replaySince('admin', 'agent-1', lastSeq) as Event[];
    expect(missed.map((e) => e.messageId)).toEqual(['m2']);
    expect(missed[0].seq as number).toBeGreaterThan(lastSeq);
  });

  it('replays nothing that the browser already has', () => {
    const gateway = new BridleGateway();
    gateway.registerClient('admin', 'agent-1', 'tab-a', () => undefined, true);
    emit(gateway, 'm1');

    const upToDate = gateway.currentSeq('admin', 'agent-1');

    expect(gateway.replaySince('admin', 'agent-1', upToDate)).toEqual([]);
  });

  it('replays only the newest frame of a streamed message', () => {
    const gateway = new BridleGateway();
    gateway.registerClient('admin', 'agent-1', 'tab-a', () => undefined, true);
    const before = gateway.currentSeq('admin', 'agent-1');

    emit(gateway, 'm1', 'stream');
    emit(gateway, 'm1', 'stream');
    emit(gateway, 'm1', 'stream_end');

    const missed = gateway.replaySince('admin', 'agent-1', before) as Event[];
    expect(missed.map((e) => e.type)).toEqual(['stream', 'stream_end']);
  });

  it('knows nothing about an identity that never connected', () => {
    const gateway = new BridleGateway();

    emit(gateway, 'm1');

    expect(gateway.currentSeq('admin', 'agent-1')).toBe(0);
    expect(gateway.replaySince('admin', 'agent-1', 0)).toEqual([]);
  });
});

/**
 * The person apart from the channel (CLEAN-80). Two admins share `admin`
 * and its history, but each sits on their own socket; the identity the hub
 * attaches to a message is the sender's, never the first socket's.
 */
describe('BridleGateway — user identity follows the sending socket', () => {
  it('attaches the sending socket user, and nothing for a socket without one', () => {
    const gateway = new BridleGateway();
    const toAgent: Event[] = [];
    gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
    gateway.registerClient('admin', 'agent-1', 'tab-a', collector([]), true, undefined, undefined, {
      id: 'user-a',
      email: 'a@example.test',
    });
    gateway.registerClient('admin', 'agent-1', 'tab-b', collector([]), true, undefined, undefined, {
      id: 'user-b',
    });
    gateway.registerClient('anon-7', 'agent-1', 'widget', collector([]), false);

    gateway.sendToAgent('admin', 'agent-1', 'from b', [], undefined, { socketId: 'tab-b' });
    gateway.sendToAgent('admin', 'agent-1', 'from a', [], undefined, { socketId: 'tab-a' });
    gateway.sendToAgent('anon-7', 'agent-1', 'from widget', [], undefined, { socketId: 'widget' });

    expect(toAgent.map((e) => e.user)).toEqual([
      { id: 'user-b' },
      { id: 'user-a', email: 'a@example.test' },
      undefined,
    ]);
    // History is still one channel: every message went out as `admin`.
    expect(toAgent.slice(0, 2).map((e) => e.clientId)).toEqual(['admin', 'admin']);
  });
});

/**
 * The page apart from the channel (CLEAN-120). The browser origin recorded
 * at the handshake rides along on each message from that socket, so a
 * runtime can send the person back to the console they came from.
 */
describe('BridleGateway — origin follows the sending socket', () => {
  it('attaches the sending socket origin, and nothing for a socket without one', () => {
    const gateway = new BridleGateway();
    const toAgent: Event[] = [];
    gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
    gateway.registerClient(
      'admin',
      'agent-1',
      'tab-a',
      collector([]),
      true,
      undefined,
      undefined,
      { id: 'user-a' },
      'https://admin.ranch.test',
    );
    gateway.registerClient('anon-7', 'agent-1', 'widget', collector([]), false);

    gateway.sendToAgent('admin', 'agent-1', 'from a', [], undefined, { socketId: 'tab-a' });
    gateway.sendToAgent('anon-7', 'agent-1', 'from widget', [], undefined, { socketId: 'widget' });

    expect(toAgent.map((e) => e.origin)).toEqual(['https://admin.ranch.test', undefined]);
  });
});

/**
 * "The agent is still answering" as a rule (CLEAN-136). A reset is refused
 * while a turn is open, so an answer to the conversation being closed cannot
 * land in the new one. Open means: a message is with the agent and nothing
 * that ends a turn came back, a stream is open, or a thinking turn is open —
 * and the agent gave a sign of life within the last 75 seconds.
 */
describe('BridleGateway — an open turn', () => {
  function chat() {
    const gateway = new BridleGateway();
    gateway.registerAgent('agent-1', 'agent-socket', () => undefined);
    gateway.registerClient('admin', 'agent-1', 'tab-a', () => undefined, true);
    const send = () =>
      gateway.sendToAgent('admin', 'agent-1', 'hello', [], undefined, {
        socketId: 'tab-a',
      });
    const fromAgent = (event: Event) =>
      gateway.handleAgentEvent('agent-1', {
        clientId: 'admin',
        ...event,
      } as never);
    return { gateway, send, fromAgent };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is closed for a conversation the hub has never seen', () => {
    expect(new BridleGateway().isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('is closed for a conversation nobody has spoken in', () => {
    const { gateway } = chat();

    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('opens when a message is handed to the agent and closes on its answer', () => {
    const { gateway, send, fromAgent } = chat();

    send();
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);

    fromAgent({ type: 'message', text: 'hi', messageId: 'm1' });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('stays open while the agent only says it is working', () => {
    const { gateway, send, fromAgent } = chat();

    send();
    fromAgent({ type: 'typing' });

    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);
  });

  it('stays open for as long as a stream is', () => {
    const { gateway, send, fromAgent } = chat();

    send();
    fromAgent({ type: 'stream', text: 'h', messageId: 'm1' });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);

    fromAgent({ type: 'stream_end', text: 'hi', messageId: 'm1' });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('stays open through a thinking turn, past the first message of it', () => {
    const { gateway, send, fromAgent } = chat();

    send();
    fromAgent({
      type: 'thinking',
      turnId: 't1',
      step: { id: 's1', label: 'Search', state: 'active' },
    });
    fromAgent({ type: 'message', text: 'one moment', messageId: 'm1' });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);

    fromAgent({ type: 'thinking', turnId: 't1', done: true });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('stops waiting after 75 seconds without a sign of life', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    const { gateway, send, fromAgent } = chat();

    send();
    fromAgent({ type: 'stream', text: 'h', messageId: 'm1' });
    jest.setSystemTime(new Date('2026-10-02T09:01:14Z'));
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);

    jest.setSystemTime(new Date('2026-10-02T09:01:16Z'));
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('counts the silence from the last sign of life, not from the question', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    const { gateway, send, fromAgent } = chat();

    send();
    jest.setSystemTime(new Date('2026-10-02T09:01:00Z'));
    fromAgent({ type: 'typing' });
    jest.setSystemTime(new Date('2026-10-02T09:02:00Z'));

    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);
  });
});

/**
 * One operation for "this conversation was reset" (CLEAN-136): the agent
 * forgets, the replay buffer goes, and every socket on the conversation is
 * told — the other tab, the other device, the other console.
 */
describe('BridleGateway — resetting a conversation', () => {
  function twoTabs() {
    const gateway = new BridleGateway();
    const toAgent: Event[] = [];
    const tabA: Event[] = [];
    const tabB: Event[] = [];
    gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
    gateway.registerClient('admin', 'agent-1', 'tab-a', collector(tabA), true);
    gateway.registerClient('admin', 'agent-1', 'tab-b', collector(tabB), true);
    return { gateway, toAgent, tabA, tabB };
  }

  const answer = (gateway: BridleGateway, messageId: string) =>
    gateway.handleAgentEvent('agent-1', {
      type: 'message',
      clientId: 'admin',
      text: messageId,
      messageId,
    });

  it('tells every socket on the conversation, once', () => {
    const { gateway, tabA, tabB } = twoTabs();

    gateway.resetConversation('agent-1', 'admin');

    expect(tabA.map((e) => e.type)).toEqual(['conversation_reset']);
    expect(tabB.map((e) => e.type)).toEqual(['conversation_reset']);
    expect(typeof tabA[0].ts).toBe('number');
    expect(tabA[0].seq).toBe(tabB[0].seq);
  });

  it('tells the agent to forget the conversation', () => {
    const { gateway, toAgent } = twoTabs();

    gateway.resetConversation('agent-1', 'admin');

    expect(toAgent).toEqual([{ type: 'session_clear', channel: 'admin' }]);
  });

  it('replays the reset, and nothing of the closed conversation, to a browser that was away', () => {
    const { gateway } = twoTabs();
    answer(gateway, 'old-1');
    answer(gateway, 'old-2');

    gateway.resetConversation('agent-1', 'admin');

    const missed = gateway.replaySince('admin', 'agent-1', 1) as Event[];
    expect(missed.map((e) => e.type)).toEqual(['conversation_reset']);
  });

  it('keeps counting upward, so the new conversation is newer than the reset', () => {
    const { gateway, tabA } = twoTabs();
    answer(gateway, 'old-1');

    gateway.resetConversation('agent-1', 'admin');
    answer(gateway, 'new-1');

    const seqs = tabA.map((e) => e.seq as number);
    expect(tabA.map((e) => e.type)).toEqual([
      'message',
      'conversation_reset',
      'message',
    ]);
    expect(seqs[1]).toBeGreaterThan(seqs[0]);
    expect(seqs[2]).toBeGreaterThan(seqs[1]);
  });

  it('closes the turn that was open', () => {
    const { gateway } = twoTabs();
    gateway.sendToAgent('admin', 'agent-1', 'hello', [], undefined, {
      socketId: 'tab-a',
    });
    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(true);

    gateway.resetConversation('agent-1', 'admin');

    expect(gateway.isTurnOpen('agent-1', 'admin')).toBe(false);
  });

  it('leaves another conversation with the same agent alone', () => {
    const { gateway, tabA } = twoTabs();
    const visitor: Event[] = [];
    gateway.registerClient(
      'share-v1',
      'agent-1',
      'visitor',
      collector(visitor),
      false,
    );

    gateway.resetConversation('agent-1', 'share-v1');

    expect(visitor.map((e) => e.type)).toEqual(['conversation_reset']);
    expect(tabA).toEqual([]);
  });

  it('is safe for a conversation nobody is connected to', () => {
    const gateway = new BridleGateway();

    expect(() => gateway.resetConversation('agent-1', 'admin')).not.toThrow();
  });
});
