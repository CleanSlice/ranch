import { BridleGateway } from './bridle.gateway';
import { BridlePart, BridlePartTypes } from '../domain/bridle.types';
import {
  AgentLimitService,
  IAgentLimitGateway,
  IAgentLimits,
} from '#/agent/limit/domain';

type Event = Record<string, unknown>;
const collector = (into: Event[]) => (data: unknown) => {
  into.push(data as Event);
};

const limits = (l: Partial<IAgentLimits>): IAgentLimits => ({
  perMinute: null,
  perHour: null,
  perDay: null,
  ...l,
});

const text = (t: string): BridlePart[] => [
  { type: BridlePartTypes.Text, text: t },
];

/** A limiter over an empty store: these cases are about the hub, not the tables. */
function makeLimiter() {
  const gateway: IAgentLimitGateway = {
    findAll: () => Promise.resolve([]),
    upsert: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    addMinutes: () => Promise.resolve(),
    minutes: () => Promise.resolve([]),
    pruneBefore: () => Promise.resolve(),
  };
  return new AgentLimitService(gateway);
}

/**
 * The hub with a real limiter behind it (CLEAN-224): the one point every
 * relayed request passes. What must hold here is what the limiter cannot know
 * by itself — which messages are requests at all, who is told what, and that
 * a refused message goes nowhere.
 */
async function makeHub(l: Partial<IAgentLimits> | null) {
  const limiter = makeLimiter();
  const gateway = new BridleGateway(limiter);
  if (l) await limiter.setLimits('agent-1', limits(l), null);

  const toAgent: Event[] = [];
  const visitor: Event[] = [];
  const otherTab: Event[] = [];
  const bystander: Event[] = [];
  const elsewhere: Event[] = [];
  gateway.registerAgent('agent-1', 'agent-socket', collector(toAgent));
  gateway.registerAgent('agent-2', 'agent-socket-2', collector([]));
  gateway.registerClient('v1', 'agent-1', 'tab-a', collector(visitor), false);
  gateway.registerClient('v1', 'agent-1', 'tab-b', collector(otherTab), false);
  gateway.registerClient('v2', 'agent-1', 'tab-c', collector(bystander), false);
  gateway.registerClient('v9', 'agent-2', 'tab-d', collector(elsewhere), false);
  return {
    gateway,
    limiter,
    toAgent,
    visitor,
    otherTab,
    bystander,
    elsewhere,
    forwarded: () => toAgent.filter((e) => e.type === 'message'),
  };
}

describe('BridleGateway — request limits', () => {
  it('forwards up to the limit and refuses the next one with the wait', async () => {
    const { gateway, forwarded } = await makeHub({ perMinute: 2 });
    const send = (id: string) =>
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'), undefined, {
        socketId: 'tab-a',
        clientMessageId: id,
        withAck: true,
      });

    expect(send('m1').status).toBe('accepted');
    expect(send('m2').status).toBe('accepted');
    const refused = send('m3');

    expect(refused).toEqual({
      status: 'rejected',
      code: 'RATE_LIMITED',
      retryAfterMs: expect.any(Number),
      window: 'minute',
    });
    if (refused.status === 'rejected' && refused.code === 'RATE_LIMITED') {
      expect(refused.retryAfterMs).toBeGreaterThan(59_000);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
    expect(forwarded()).toHaveLength(2);
  });

  it('shows a refused message to nobody: not to the agent, not to the other tab', async () => {
    const { gateway, forwarded, otherTab, visitor } = await makeHub({
      perMinute: 1,
    });
    gateway.sendToAgent('v1', 'agent-1', 'one', text('one'), undefined, {
      socketId: 'tab-a',
      clientMessageId: 'm1',
      withAck: true,
    });
    otherTab.length = 0;

    gateway.sendToAgent('v1', 'agent-1', 'two', text('two'), undefined, {
      socketId: 'tab-a',
      clientMessageId: 'm2',
      withAck: true,
    });

    expect(forwarded()).toHaveLength(1);
    // No echo of a question nobody was allowed to ask.
    expect(otherTab).toEqual([]);
    // A sender that reads the acknowledgement gets no sentence in the
    // conversation on top of it.
    expect(visitor.filter((e) => e.type === 'message')).toEqual([]);
  });

  it('opens no turn for a refused message', async () => {
    const { gateway } = await makeHub({ perMinute: 1 });
    gateway.sendToAgent('v2', 'agent-1', 'one', text('one'));
    expect(gateway.isTurnOpen('agent-1', 'v2')).toBe(true);

    gateway.sendToAgent('v1', 'agent-1', 'two', text('two'), undefined, {
      clientMessageId: 'm2',
      withAck: true,
    });
    expect(gateway.isTurnOpen('agent-1', 'v1')).toBe(false);
  });

  it('does not count a repeat of a message it already accepted', async () => {
    const { gateway, forwarded } = await makeHub({ perMinute: 2 });
    const send = (id: string) =>
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'), undefined, {
        clientMessageId: id,
        withAck: true,
      });

    send('m1');
    // The acknowledgement was lost and the browser resends, twice.
    expect(send('m1')).toEqual(
      expect.objectContaining({ status: 'accepted', duplicate: true }),
    );
    expect(send('m1').status).toBe('accepted');
    // The allowance still has room for a second real message.
    expect(send('m2').status).toBe('accepted');
    expect(send('m3').status).toBe('rejected');
    expect(forwarded()).toHaveLength(2);
  });

  it('does not count a message to an agent that is offline', async () => {
    const { gateway, limiter } = await makeHub({ perMinute: 1 });
    gateway.unregisterAgent('agent-1', 'agent-socket');

    for (let i = 0; i < 5; i++) {
      expect(
        gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'), undefined, {
          clientMessageId: `m${i}`,
          withAck: true,
        }),
      ).toEqual({ status: 'rejected', code: 'AGENT_OFFLINE' });
    }
    // Nothing was used up while it was away.
    expect(limiter.remainingFor('agent-1')?.remaining).toBe(1);
  });

  it('never refuses an operator or another agent, and does not charge them', async () => {
    const { gateway, forwarded, limiter } = await makeHub({ perMinute: 1 });

    for (let i = 0; i < 4; i++) {
      expect(
        gateway.sendToAgent('admin', 'agent-1', 'hi', text('hi'), undefined, {
          source: 'operator',
        }).status,
      ).toBe('accepted');
      expect(
        gateway.sendToAgent(
          'peer:x:c',
          'agent-1',
          'hi',
          text('hi'),
          undefined,
          {
            source: 'peer',
          },
        ).status,
      ).toBe('accepted');
    }
    expect(forwarded()).toHaveLength(8);
    expect(limiter.remainingFor('agent-1')?.remaining).toBe(1);

    // And an operator still gets through once visitors have filled it.
    gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
    expect(gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi')).status).toBe(
      'rejected',
    );
    expect(
      gateway.sendToAgent('admin', 'agent-1', 'hi', text('hi'), undefined, {
        source: 'operator',
      }).status,
    ).toBe('accepted');
  });

  it('treats a caller that does not say who it is as a visitor', async () => {
    const { gateway } = await makeHub({ perMinute: 1 });
    gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
    expect(gateway.sendToAgent('v2', 'agent-1', 'hi', text('hi')).status).toBe(
      'rejected',
    );
  });

  it('shares one allowance between everyone who talks to the agent', async () => {
    const { gateway } = await makeHub({ perMinute: 2 });
    expect(gateway.sendToAgent('v1', 'agent-1', 'a', text('a')).status).toBe(
      'accepted',
    );
    expect(gateway.sendToAgent('v2', 'agent-1', 'b', text('b')).status).toBe(
      'accepted',
    );
    expect(
      gateway.sendToAgent('share-x', 'agent-1', 'c', text('c')).status,
    ).toBe('rejected');
    // Another agent is untouched.
    expect(gateway.sendToAgent('v9', 'agent-2', 'd', text('d')).status).toBe(
      'accepted',
    );
  });

  it('refuses nothing for an agent with limits off', async () => {
    const { gateway, forwarded } = await makeHub(null);
    for (let i = 0; i < 200; i++) {
      expect(
        gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi')).status,
      ).toBe('accepted');
    }
    expect(forwarded()).toHaveLength(200);
  });

  it('works exactly as before when no limiter is wired in', () => {
    const gateway = new BridleGateway();
    gateway.registerAgent('agent-1', 's', collector([]));
    expect(gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi')).status).toBe(
      'accepted',
    );
    expect(gateway.agentLimitEvent('agent-1')).toBeNull();
    expect(gateway.limitRemaining('agent-1')).toBeNull();
  });

  describe('a sender that reads no acknowledgement (widget before 0.16, old bundles)', () => {
    it('gets a readable line in the conversation saying when to try again', async () => {
      const { gateway, visitor, bystander } = await makeHub({ perMinute: 1 });
      gateway.sendToAgent('v2', 'agent-1', 'one', text('one'));

      const result = gateway.sendToAgent(
        'v1',
        'agent-1',
        'two',
        text('two'),
        undefined,
        {
          socketId: 'tab-a',
        },
      );

      expect(result.status).toBe('rejected');
      const lines = visitor.filter((e) => e.type === 'message');
      expect(lines).toHaveLength(1);
      // A full minute to wait, give or take the milliseconds this test took.
      expect([
        'This agent has reached its message limit. Try again in about 60 seconds.',
        'This agent has reached its message limit. Try again in about 1 minute.',
      ]).toContain(lines[0].text);
      expect(lines[0].parts).toEqual([{ type: 'text', text: lines[0].text }]);
      // Only the conversation that was refused sees it.
      expect(bystander.filter((e) => e.type === 'message')).toEqual([]);
    });

    it('gets no line when the caller renders the refusal itself', async () => {
      const { gateway, visitor } = await makeHub({ perMinute: 1 });
      gateway.sendToAgent('v2', 'agent-1', 'one', text('one'));

      gateway.sendToAgent('v1', 'agent-1', 'two', text('two'), undefined, {
        silentRefusal: true,
      });

      expect(visitor.filter((e) => e.type === 'message')).toEqual([]);
    });
  });

  describe('telling open chats (agent_limit)', () => {
    const limitEvents = (events: Event[]) =>
      events.filter((e) => e.type === 'agent_limit');

    it('tells every socket of the agent when an hour window fills, and nobody else', async () => {
      const { gateway, visitor, otherTab, bystander, elsewhere } =
        await makeHub({
          perHour: 1,
        });

      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));

      for (const socket of [visitor, otherTab, bystander]) {
        expect(limitEvents(socket)).toEqual([
          {
            type: 'agent_limit',
            agentId: 'agent-1',
            limited: true,
            retryAfterMs: expect.any(Number),
            window: 'hour',
          },
        ]);
      }
      expect(limitEvents(elsewhere)).toEqual([]);
    });

    it('never announces a minute window', async () => {
      const { gateway, visitor, bystander } = await makeHub({ perMinute: 1 });
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
      expect(limitEvents(visitor)).toEqual([]);
      expect(limitEvents(bystander)).toEqual([]);
      expect(gateway.agentLimitEvent('agent-1')).toBeNull();
    });

    it('has the event ready for a chat that connects while the window is full', async () => {
      const { gateway } = await makeHub({ perDay: 1 });
      expect(gateway.agentLimitEvent('agent-1')).toBeNull();

      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));

      expect(gateway.agentLimitEvent('agent-1')).toEqual({
        type: 'agent_limit',
        agentId: 'agent-1',
        limited: true,
        retryAfterMs: expect.any(Number),
        window: 'day',
      });
    });

    it('calls the wait off when the limit is raised or removed', async () => {
      const { gateway, limiter, bystander } = await makeHub({ perHour: 1 });
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
      bystander.length = 0;

      await limiter.setLimits('agent-1', limits({ perHour: 10 }), null);
      expect(limitEvents(bystander)).toEqual([
        { type: 'agent_limit', agentId: 'agent-1', limited: false },
      ]);

      bystander.length = 0;
      await limiter.setLimits('agent-1', limits({ perHour: 1 }), null);
      expect(limitEvents(bystander)).toHaveLength(1);
      expect(limitEvents(bystander)[0].limited).toBe(true);

      bystander.length = 0;
      await limiter.setLimits('agent-1', null, null);
      expect(limitEvents(bystander)).toEqual([
        { type: 'agent_limit', agentId: 'agent-1', limited: false },
      ]);
    });

    it('carries no limit value and no usage figure', async () => {
      const { gateway, bystander } = await makeHub({ perHour: 1 });
      gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
      const [event] = limitEvents(bystander);
      expect(Object.keys(event).sort()).toEqual(
        ['agentId', 'limited', 'retryAfterMs', 'type', 'window'].sort(),
      );
    });
  });

  it('reports conversations with a turn open as requests in progress', async () => {
    const { gateway, limiter } = await makeHub({ perMinute: 10 });
    const inFlight = async () =>
      (await limiter.snapshot({ id: 'agent-1', isPublic: true })).inFlight;

    expect(await inFlight()).toBe(0);
    gateway.sendToAgent('v1', 'agent-1', 'hi', text('hi'));
    gateway.sendToAgent('v2', 'agent-1', 'hi', text('hi'));
    expect(await inFlight()).toBe(2);

    gateway.handleAgentEvent('agent-1', {
      type: 'message',
      clientId: 'v1',
      text: 'done',
      messageId: 'a1',
    });
    expect(await inFlight()).toBe(1);
  });
});
