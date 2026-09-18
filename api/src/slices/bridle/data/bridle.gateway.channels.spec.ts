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
