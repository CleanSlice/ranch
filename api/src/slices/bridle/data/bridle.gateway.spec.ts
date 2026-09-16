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
  const parts: BridlePart[] = [
    { type: BridlePartTypes.Text, text: 'look' },
  ];

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

  it('picks the most recent turn when two people chat with one agent', () => {
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

    expect(gateway.findActiveTurn('agent-1')).toMatchObject({
      clientId: 'visitor',
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
