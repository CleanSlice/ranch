import { describe, expect, test } from 'bun:test';
import {
  deriveLaunch,
  launchStepIds,
  type LaunchFacts,
  type LaunchPodFacts,
} from './launchSteps';

const pod = (over: Partial<LaunchPodFacts> = {}): LaunchPodFacts => ({
  phase: 'Pending',
  ready: false,
  containerWaitingReason: null,
  superseded: false,
  ...over,
});

/** A restart, answered, the old instance still there. */
const facts = (over: Partial<LaunchFacts> = {}): LaunchFacts => ({
  kind: 'restart',
  requestInFlight: false,
  status: 'deploying',
  statusReason: null,
  pod: null,
  hubConnected: false,
  wentDown: false,
  tools: null,
  ...over,
});

/** A start: there was no instance, so nothing has to go down first. */
const start = (over: Partial<LaunchFacts> = {}): LaunchFacts =>
  facts({ kind: 'start', wentDown: true, ...over });

/** `accepted:done stopped:current …` — one line a failure is easy to read in. */
const line = (f: LaunchFacts) =>
  deriveLaunch(f)
    .steps.map((s) => `${s.id}:${s.state}`)
    .join(' ');

describe('which steps a launch has', () => {
  test('only a restart takes an old instance down first', () => {
    expect(launchStepIds('restart')).toEqual([
      'accepted',
      'stopped',
      'scheduled',
      'container',
      'online',
      'ready',
    ]);
    expect(launchStepIds('start')).toEqual([
      'accepted',
      'scheduled',
      'container',
      'online',
      'ready',
    ]);
    expect(launchStepIds('initial')).toEqual(launchStepIds('start'));
  });
});

describe('a restart, stage by stage', () => {
  test('the call is still out: nothing is done yet', () => {
    expect(line(facts({ requestInFlight: true, status: 'running', hubConnected: true }))).toBe(
      'accepted:current stopped:upcoming scheduled:upcoming container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('accepted, the old instance still on the hub', () => {
    expect(line(facts({ hubConnected: true, pod: pod({ phase: 'Running', ready: true }) }))).toBe(
      'accepted:done stopped:current scheduled:upcoming container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('the old instance is gone, no pod yet', () => {
    expect(line(facts({ wentDown: true }))).toBe(
      'accepted:done stopped:done scheduled:current container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('a pending pod with no waiting reason is not scheduled yet', () => {
    expect(line(facts({ wentDown: true, pod: pod() }))).toBe(
      'accepted:done stopped:done scheduled:current container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('a waiting reason means it was scheduled and the container is being prepared', () => {
    expect(
      line(facts({ wentDown: true, pod: pod({ containerWaitingReason: 'ContainerCreating' }) })),
    ).toBe(
      'accepted:done stopped:done scheduled:done container:current online:upcoming ready:upcoming',
    );
  });

  test('a running pod that is not on the hub yet', () => {
    expect(line(facts({ wentDown: true, pod: pod({ phase: 'Running' }) }))).toBe(
      'accepted:done stopped:done scheduled:done container:done online:current ready:upcoming',
    );
  });

  test('on the hub, the status not written yet', () => {
    expect(
      line(facts({ wentDown: true, hubConnected: true, pod: pod({ phase: 'Running', ready: true }) })),
    ).toBe('accepted:done stopped:done scheduled:done container:done online:done ready:current');
  });

  test('running, tools still connecting: that wait belongs to the last step', () => {
    const view = deriveLaunch(
      facts({ wentDown: true, hubConnected: true, status: 'running', tools: 'connecting' }),
    );
    expect(view.steps.at(-1)).toEqual({ id: 'ready', state: 'current', reason: null });
    expect(view.outcome).toBe('running');
  });

  test('running and usable: every step done', () => {
    const view = deriveLaunch(
      facts({ wentDown: true, hubConnected: true, status: 'running', tools: 'limited' }),
    );
    expect(view.steps.every((s) => s.state === 'done')).toBe(true);
    expect(view.outcome).toBe('ready');
    expect(view.reached).toBe(5);
  });
});

describe('the instance being replaced does not tick the list', () => {
  test('its pod and its hub connection prove nothing before it left the hub', () => {
    expect(
      line(
        facts({
          status: 'running',
          hubConnected: true,
          pod: pod({ phase: 'Running', ready: true }),
        }),
      ),
    ).toBe(
      'accepted:done stopped:current scheduled:upcoming container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('off the hub and still terminating: the server says the pod is superseded', () => {
    // The old pod stays Running for as long as it takes to terminate.
    expect(
      line(facts({ wentDown: true, pod: pod({ phase: 'Running', ready: true, superseded: true }) })),
    ).toBe(
      'accepted:done stopped:done scheduled:current container:upcoming online:upcoming ready:upcoming',
    );
  });

  test('while the call is out, the stream is not about this launch yet', () => {
    expect(
      line(start({ requestInFlight: true, hubConnected: true, pod: pod({ phase: 'Running' }) })),
    ).toBe('accepted:current scheduled:upcoming container:upcoming online:upcoming ready:upcoming');
  });

  test('a list without the stopped row waits for the old instance all the same', () => {
    // Someone who may not manage the agent is not told it is a restart.
    expect(
      line(facts({ kind: 'start', hubConnected: true, pod: pod({ phase: 'Running', ready: true }) })),
    ).toBe('accepted:done scheduled:current container:upcoming online:upcoming ready:upcoming');
  });
});

describe('a start has nothing to take down', () => {
  test('pod facts count as soon as the call is answered', () => {
    expect(line(start({ pod: pod({ phase: 'Running' }) }))).toBe(
      'accepted:done scheduled:done container:done online:current ready:upcoming',
    );
  });

  test('a first start reads the same way', () => {
    expect(line(start({ kind: 'initial' }))).toBe(
      'accepted:done scheduled:current container:upcoming online:upcoming ready:upcoming',
    );
  });
});

describe('stages nobody saw', () => {
  test('on the hub with no pod at all (a local run): everything before is done', () => {
    expect(line(start({ hubConnected: true }))).toBe(
      'accepted:done scheduled:done container:done online:done ready:current',
    );
  });
});

describe('the list does not go back', () => {
  test('a flickering fact keeps what an earlier reading reached', () => {
    const before = deriveLaunch(start({ pod: pod({ phase: 'Running' }) }));
    expect(before.reached).toBe(2);
    const after = deriveLaunch(start({ pod: null, floor: before.reached }));
    expect(after.steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });

  test('without a floor the same facts start over: a new launch', () => {
    expect(deriveLaunch(start({ pod: null })).reached).toBe(0);
  });
});

describe('failure', () => {
  test('pins the step that was current, with the server reason as received', () => {
    const view = deriveLaunch(
      facts({
        wentDown: true,
        status: 'failed',
        statusReason: 'Back-off pulling image "ranch/agent:nope"',
        pod: pod({ containerWaitingReason: 'ImagePullBackOff' }),
      }),
    );
    expect(view.outcome).toBe('failed');
    expect(view.steps.map((s) => `${s.id}:${s.state}`)).toEqual([
      'accepted:done',
      'stopped:done',
      'scheduled:done',
      'container:failed',
      'online:upcoming',
      'ready:upcoming',
    ]);
    expect(view.steps[3]?.reason).toBe('Back-off pulling image "ranch/agent:nope"');
  });

  test('falls back to the waiting reason, then to nothing', () => {
    const withPod = deriveLaunch(
      start({ status: 'failed', pod: pod({ containerWaitingReason: 'CrashLoopBackOff' }) }),
    );
    expect(withPod.steps.find((s) => s.state === 'failed')?.reason).toBe('CrashLoopBackOff');
    const bare = deriveLaunch(start({ status: 'failed' }));
    expect(bare.steps.find((s) => s.state === 'failed')).toEqual({
      id: 'scheduled',
      state: 'failed',
      reason: null,
    });
  });

  test('the waiting reason of a superseded pod is not this launch\'s reason', () => {
    const view = deriveLaunch(
      start({
        status: 'failed',
        pod: pod({ containerWaitingReason: 'CrashLoopBackOff', superseded: true }),
      }),
    );
    expect(view.steps.find((s) => s.state === 'failed')?.reason).toBe(null);
  });

  // A loop, not `test.each`: the consoles' test typings know `test` alone.
  for (const id of ['accepted', 'scheduled', 'container', 'online', 'ready'] as const) {
    test(`can land on ${id}`, () => {
      const order = launchStepIds('start');
      const view = deriveLaunch(
        start({ status: 'failed', requestInFlight: true, floor: order.indexOf(id) - 1 }),
      );
      expect(view.steps.find((s) => s.state === 'failed')?.id).toBe(id);
    });
  }

  test('a pod that is up and never reaches the hub fails the online step', () => {
    const view = deriveLaunch(
      start({
        status: 'unreachable',
        statusReason: 'runtime never registered on the hub',
        pod: pod({ phase: 'Running', ready: true }),
      }),
    );
    expect(view.steps.find((s) => s.state === 'failed')).toEqual({
      id: 'online',
      state: 'failed',
      reason: 'runtime never registered on the hub',
    });
  });
});

describe('stopping is not failing', () => {
  test('a stop during a launch ends it with no failed step', () => {
    const view = deriveLaunch(facts({ wentDown: true, status: 'stopped' }));
    expect(view.outcome).toBe('stopped');
    expect(view.steps.some((s) => s.state === 'failed')).toBe(false);
  });
});

describe('shape', () => {
  test('at most one step is current or failed, with done before and upcoming after', () => {
    const samples: LaunchFacts[] = [
      facts({ requestInFlight: true }),
      facts({ wentDown: true }),
      facts({ wentDown: true, pod: pod({ phase: 'Running' }) }),
      start({ status: 'failed' }),
      start({ kind: 'initial', hubConnected: true, status: 'running' }),
    ];
    for (const sample of samples) {
      const states = deriveLaunch(sample).steps.map((s) => s.state);
      const active = states.filter((s) => s === 'current' || s === 'failed');
      expect(active.length <= 1).toBe(true);
      const at = states.findIndex((s) => s === 'current' || s === 'failed');
      const split = at === -1 ? states.length : at;
      expect(states.slice(0, split).every((s) => s === 'done')).toBe(true);
      expect(states.slice(split + 1).every((s) => s === 'upcoming')).toBe(true);
    }
  });
});
