import { BridleGateway } from './bridle.gateway';
import { BridleAttachmentKinds, BridlePartTypes } from '../domain';
import type { BridlePart, IBridleAttachment } from '../domain';

/**
 * Covers what crosses the hub → runtime wire for a message with stored
 * attachments: references travel as metadata only. The url is this API's own
 * route (useless to the runtime) and readableByAgent is a UI concern — the
 * runtime persists the array verbatim into the transcript, so anything extra
 * sent here would leak into every replay.
 */
describe('BridleGateway.sendToAgent', () => {
  const attachment: IBridleAttachment = {
    id: 'a1',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 9,
    kind: BridleAttachmentKinds.Image,
    url: '/api/agent/agent-1/attachment/a1',
    readableByAgent: true,
  };
  const parts: BridlePart[] = [{ type: BridlePartTypes.Text, text: 'look' }];

  function connectedAgent() {
    const gateway = new BridleGateway();
    const received: Array<Record<string, unknown>> = [];
    gateway.registerAgent('agent-1', 'socket-1', (data) =>
      received.push(data as Record<string, unknown>),
    );
    return { gateway, received };
  }

  it('sends attachment references as metadata only', () => {
    const { gateway, received } = connectedAgent();

    gateway.sendToAgent('admin', 'agent-1', 'look', parts, [attachment]);

    expect(received).toHaveLength(1);
    expect(received[0].attachments).toEqual([
      {
        id: 'a1',
        name: 'photo.png',
        mimeType: 'image/png',
        size: 9,
        kind: BridleAttachmentKinds.Image,
      },
    ]);
  });

  it('omits the attachments key entirely for plain messages', () => {
    const { gateway, received } = connectedAgent();

    gateway.sendToAgent('admin', 'agent-1', 'hello', parts);

    expect(received).toHaveLength(1);
    expect('attachments' in received[0]).toBe(false);
  });
});

/**
 * Active-turn tracking (CLEAN-74). The hub learns which turn is open purely
 * from the thinking events it already relays, so API-side code can add a
 * delegation step to the timeline the person is watching. Getting this wrong
 * is not subtle: a step published under an unknown turnId closes the
 * runtime's own block in every console that renders thinking.
 */
describe('BridleGateway.findActiveTurn', () => {
  const step = { id: 's1', label: 'Searching', state: 'active' as const };

  function hubWithClient(clientId = 'admin', agentId = 'agent-1') {
    const gateway = new BridleGateway();
    gateway.registerClient(clientId, agentId, 'socket-1', () => {}, true);
    return gateway;
  }

  it('knows nothing before the agent publishes a step', () => {
    const gateway = hubWithClient();

    expect(gateway.findActiveTurn('agent-1')).toBeNull();
  });

  it('remembers the turn a step belongs to', () => {
    const gateway = hubWithClient();

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      step,
      ts: 1000,
    });

    expect(gateway.findActiveTurn('agent-1')).toEqual({
      clientId: 'admin',
      turnId: 'turn-1',
      ts: 1000,
    });
  });

  it('follows the turn as later steps arrive', () => {
    const gateway = hubWithClient();

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      step,
      ts: 1000,
    });
    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-2',
      step: { ...step, id: 's2' },
      ts: 2000,
    });

    expect(gateway.findActiveTurn('agent-1')?.turnId).toBe('turn-2');
  });

  it('forgets the turn once the agent ends it', () => {
    const gateway = hubWithClient();

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      step,
      ts: 1000,
    });
    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      done: true,
      ts: 1500,
    });

    expect(gateway.findActiveTurn('agent-1')).toBeNull();
  });

  it('forgets the turn when the watching client disconnects', () => {
    const gateway = hubWithClient();

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      step,
      ts: 1000,
    });
    gateway.unregisterClient('admin', 'agent-1', 'socket-1');

    expect(gateway.findActiveTurn('agent-1')).toBeNull();
  });

  // CLEAN-236. The most recent turn used to win here, which showed one
  // person the task and the answer of another person's delegation.
  it('names the turn of the conversation asked about when two people chat with one agent, and none when not told which', () => {
    const gateway = new BridleGateway();
    gateway.registerClient('admin', 'agent-1', 'socket-1', () => {}, true);
    gateway.registerClient('visitor', 'agent-1', 'socket-2', () => {}, false);

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-admin',
      step,
      ts: 1000,
    });
    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'visitor',
      turnId: 'turn-visitor',
      step: { ...step, id: 's2' },
      ts: 2000,
    });

    expect(gateway.findActiveTurn('agent-1', 'visitor')).toMatchObject({
      clientId: 'visitor',
      turnId: 'turn-visitor',
    });
    expect(gateway.findActiveTurn('agent-1', 'admin')).toMatchObject({
      clientId: 'admin',
      turnId: 'turn-admin',
    });
    // Somebody with no turn running, and nobody at all: no guess.
    expect(gateway.findActiveTurn('agent-1', 'stranger')).toBeNull();
    expect(gateway.findActiveTurn('agent-1')).toBeNull();
  });

  it('names the one running turn when not told which, since it can only be that one', () => {
    const gateway = new BridleGateway();
    gateway.registerClient('visitor', 'agent-1', 'socket-2', () => {}, false);
    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'visitor',
      turnId: 'turn-visitor',
      step,
      ts: 2000,
    });

    expect(gateway.findActiveTurn('agent-1')).toMatchObject({
      clientId: 'visitor',
      turnId: 'turn-visitor',
    });
    expect(gateway.findActiveTurn('agent-1', null)).toMatchObject({
      turnId: 'turn-visitor',
    });
  });

  it('keeps turns of different agents apart', () => {
    const gateway = new BridleGateway();
    gateway.registerClient('admin', 'agent-1', 'socket-1', () => {}, true);
    gateway.registerClient('admin', 'agent-2', 'socket-2', () => {}, true);

    gateway.handleAgentEvent('agent-2', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-2',
      step,
      ts: 1000,
    });

    expect(gateway.findActiveTurn('agent-1')).toBeNull();
    expect(gateway.findActiveTurn('agent-2')?.turnId).toBe('turn-2');
  });

  it('still relays the thinking event it learned the turn from', () => {
    const gateway = new BridleGateway();
    const received: Array<Record<string, unknown>> = [];
    gateway.registerClient(
      'admin',
      'agent-1',
      'socket-1',
      (data) => received.push(data as Record<string, unknown>),
      true,
    );

    gateway.handleAgentEvent('agent-1', {
      type: 'thinking',
      clientId: 'admin',
      turnId: 'turn-1',
      step,
      ts: 1000,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'thinking', turnId: 'turn-1' });
  });
});

/**
 * CLEAN-236. Every Owner and Admin used to be the client `admin`, and the
 * runtime read "an administrator is sending" off that id. An Admin's id is
 * their own now, so the hub says it on the message.
 */
describe('BridleGateway — the word that an administrator is sending', () => {
  function connectedAgent() {
    const gateway = new BridleGateway();
    const received: Array<Record<string, unknown>> = [];
    gateway.registerAgent('agent-1', 'socket-a', (data) =>
      received.push(data as Record<string, unknown>),
    );
    return { gateway, received };
  }
  const say = (
    gateway: BridleGateway,
    clientId: string,
    options: Record<string, unknown> = {},
  ) => gateway.sendToAgent(clientId, 'agent-1', 'hi', [], undefined, options);

  it('is read off the sending socket: an Admin’s yes, a User’s no', () => {
    const { gateway, received } = connectedAgent();
    gateway.registerClient('user-admin', 'agent-1', 's-1', () => {}, true);
    gateway.registerClient('user-user', 'agent-1', 's-2', () => {}, false);

    say(gateway, 'user-admin', { socketId: 's-1' });
    say(gateway, 'user-user', { socketId: 's-2' });

    expect(received[0]).toMatchObject({ clientId: 'user-admin', admin: true });
    expect(received[1]).toMatchObject({ clientId: 'user-user' });
    expect(received[1]).not.toHaveProperty('admin');
  });

  it('is what the caller states when it verified the sender itself, whatever socket shares the conversation', () => {
    const { gateway, received } = connectedAgent();
    // A User's conversation, with nothing administrative about its socket …
    gateway.registerClient('user-user', 'agent-1', 's-2', () => {}, false);
    // … and an HTTP route that verified an administrator's token.
    say(gateway, 'user-admin', { admin: true });
    // Stated as no, it stays no on an administrator's socket too.
    gateway.registerClient('user-admin', 'agent-1', 's-1', () => {}, true);
    say(gateway, 'user-admin', { socketId: 's-1', admin: false });

    expect(received[0]).toMatchObject({ admin: true });
    expect(received[1]).not.toHaveProperty('admin');
  });

  it('is never a property a visitor’s message carries', () => {
    const { gateway, received } = connectedAgent();

    say(gateway, 'anon-1');
    say(gateway, 'share-1', { user: null });

    for (const message of received) expect(message).not.toHaveProperty('admin');
  });

  it('says whether an administrator is on a conversation: the Owner’s own, or one with such a socket', () => {
    const { gateway } = connectedAgent();
    gateway.registerClient('user-admin', 'agent-1', 's-1', () => {}, true);
    gateway.registerClient('user-user', 'agent-1', 's-2', () => {}, false);

    expect(gateway.isAdminChannel('admin', 'agent-1')).toBe(true);
    expect(gateway.isAdminChannel('user-admin', 'agent-1')).toBe(true);
    expect(gateway.isAdminChannel('user-user', 'agent-1')).toBe(false);
    expect(gateway.isAdminChannel('nobody', 'agent-1')).toBe(false);
    // Per agent: the same person on another agent's conversation is not it.
    expect(gateway.isAdminChannel('user-admin', 'agent-2')).toBe(false);
  });
});

/**
 * What a chat is told about the agent's tools (CLEAN-245): one word beside
 * `connected`, sent again when it changes. A runtime that reports nothing
 * (older than 0.40) reads as null — the chat shows what it always did.
 */
describe('BridleGateway — agent_status carries the tool summary', () => {
  function chat() {
    const gateway = new BridleGateway();
    const frames: Array<Record<string, unknown>> = [];
    gateway.registerClient(
      'user-1',
      'agent-1',
      'client-socket',
      (data) => frames.push(data as Record<string, unknown>),
      false,
    );
    const status = () => frames.filter((f) => f.type === 'agent_status');
    return { gateway, status };
  }

  it('null for a runtime that has not reported', () => {
    const { gateway, status } = chat();
    gateway.registerAgent('agent-1', 'socket-1', () => undefined);

    expect(status()).toEqual([
      {
        type: 'agent_status',
        agentId: 'agent-1',
        connected: true,
        tools: null,
      },
    ]);
    expect(gateway.agentTools('agent-1')).toBeNull();
  });

  it('is sent again when the summary changes, and only then', () => {
    const { gateway, status } = chat();
    gateway.registerAgent('agent-1', 'socket-1', () => undefined);

    gateway.setAgentTools('agent-1', 'socket-1', 'connecting');
    gateway.setAgentTools('agent-1', 'socket-1', 'connecting');
    gateway.setAgentTools('agent-1', 'socket-1', 'limited');
    gateway.setAgentTools('agent-1', 'socket-1', null);

    expect(status().map((f) => f.tools)).toEqual([
      null,
      'connecting',
      'limited',
      null,
    ]);
    expect(status().every((f) => f.connected === true)).toBe(true);
  });

  it('ignores a socket that is not the agent’s', () => {
    const { gateway, status } = chat();
    gateway.registerAgent('agent-1', 'socket-1', () => undefined);

    gateway.setAgentTools('agent-1', 'socket-old', 'limited');
    gateway.setAgentTools('agent-2', 'socket-1', 'limited');

    expect(status()).toHaveLength(1);
    expect(gateway.agentTools('agent-1')).toBeNull();
  });

  it('a new runtime starts with nothing said', () => {
    const { gateway, status } = chat();
    gateway.registerAgent('agent-1', 'socket-1', () => undefined);
    gateway.setAgentTools('agent-1', 'socket-1', 'limited');

    gateway.registerAgent('agent-1', 'socket-2', () => undefined);

    expect(gateway.agentTools('agent-1')).toBeNull();
    expect(status().at(-1)).toMatchObject({ connected: true, tools: null });
  });

  it('gone with the agent', () => {
    const { gateway, status } = chat();
    gateway.registerAgent('agent-1', 'socket-1', () => undefined);
    gateway.setAgentTools('agent-1', 'socket-1', 'limited');

    gateway.unregisterAgent('agent-1', 'socket-1');

    expect(status().at(-1)).toEqual({
      type: 'agent_status',
      agentId: 'agent-1',
      connected: false,
      tools: null,
    });
  });
});
