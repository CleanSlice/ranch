import {
  buildDelegationStep,
  causeText,
  delegationStepId,
} from './delegationStep';
import {
  DelegationErrorCodes,
  DelegationStatuses,
  type IAgentDelegationData,
} from './peer.types';

/**
 * The visible half of a delegation. Two things must hold at once: the admin
 * chat gets structured fields to draw, and every other surface — which renders
 * a plain label and some markdown — still gets the whole story in words. The
 * cases below check both readings of the same object.
 */
const row = (
  overrides: Partial<IAgentDelegationData> = {},
): IAgentDelegationData => ({
  id: 'del-1',
  agentId: 'a',
  peerId: 'peer-1',
  peerAgentId: 'b',
  peerName: 'Support Bot',
  contextId: 'ctx-1',
  turnId: 'turn-1',
  clientId: 'admin',
  task: 'What is the return window for shoes?',
  reason: 'Support Bot holds the returns policy base',
  matchedSkills: [{ id: 'knowledge:9a', name: 'Returns policy' }],
  status: DelegationStatuses.Waiting,
  errorCode: null,
  excerpt: null,
  startedAt: '2026-09-14T10:00:00.000Z',
  finishedAt: null,
  durationMs: null,
  ...overrides,
});

describe('buildDelegationStep', () => {
  it('keeps one id across both pushes, so the step updates in place', () => {
    const started = buildDelegationStep(row());
    const finished = buildDelegationStep(
      row({ status: DelegationStatuses.Answered, durationMs: 3120 }),
    );

    expect(started.id).toBe(delegationStepId('del-1'));
    expect(finished.id).toBe(started.id);
  });

  it('shimmers while waiting and settles when the answer lands', () => {
    expect(buildDelegationStep(row()).state).toBe('active');
    expect(
      buildDelegationStep(row({ status: DelegationStatuses.Answered })).state,
    ).toBe('done');
  });

  it('names the peer in the label, with what happened to it', () => {
    expect(buildDelegationStep(row()).label).toBe('Asking «Support Bot»');
    expect(
      buildDelegationStep(row({ status: DelegationStatuses.Answered })).label,
    ).toBe('Answered by «Support Bot»');
    expect(
      buildDelegationStep(row({ status: DelegationStatuses.Failed })).label,
    ).toBe('Could not reach «Support Bot»');
    expect(
      buildDelegationStep(row({ status: DelegationStatuses.Rejected })).label,
    ).toBe('«Support Bot» refused the task');
  });

  it('carries peer, reason, task and matched skills for the admin layout', () => {
    const step = buildDelegationStep(row());

    expect(step.kind).toBe('delegation');
    expect(step.delegation).toMatchObject({
      delegationId: 'del-1',
      peerAgentId: 'b',
      peerName: 'Support Bot',
      reason: 'Support Bot holds the returns policy base',
      task: 'What is the return window for shoes?',
      matchedSkills: [{ id: 'knowledge:9a', name: 'Returns policy' }],
      status: 'waiting',
      startedAt: Date.parse('2026-09-14T10:00:00.000Z'),
    });
  });

  it('tells the same story in the detail, for surfaces that read only words', () => {
    const detail = buildDelegationStep(row()).detail ?? '';

    expect(detail).toContain('Support Bot');
    expect(detail).toContain('Returns policy');
    expect(detail).toContain('Support Bot holds the returns policy base');
    expect(detail).toContain('What is the return window for shoes?');
    expect(detail).toContain('waiting');
  });

  it('reports how long an answer took, and quotes it', () => {
    const step = buildDelegationStep(
      row({
        status: DelegationStatuses.Answered,
        excerpt: 'Shoes can be returned within 30 days.',
        durationMs: 3120,
      }),
    );

    expect(step.detail).toContain('3.1 s');
    expect(step.detail).toContain('Shoes can be returned within 30 days.');
    expect(step.delegation).toMatchObject({
      durationMs: 3120,
      excerpt: 'Shoes can be returned within 30 days.',
    });
  });

  it('explains a failure in product wording, never in error text', () => {
    const step = buildDelegationStep(
      row({
        status: DelegationStatuses.Failed,
        errorCode: DelegationErrorCodes.NotRunning,
        excerpt: 'peer not running',
        durationMs: 180,
      }),
    );

    expect(step.detail).toContain('it is not running');
    expect(step.delegation?.excerpt).toBe('it is not running');
  });

  it('says what a refusal means rather than quoting a rule name', () => {
    const loop = buildDelegationStep(
      row({
        status: DelegationStatuses.Rejected,
        errorCode: DelegationErrorCodes.RejectedLoop,
        durationMs: 40,
      }),
    );
    const depth = buildDelegationStep(
      row({
        status: DelegationStatuses.Rejected,
        errorCode: DelegationErrorCodes.RejectedDepth,
        durationMs: 40,
      }),
    );

    expect(loop.detail).toContain(
      'would loop back to an agent already involved',
    );
    expect(depth.detail).toContain('as long as it may get');
  });

  it('shows sub-second waits in milliseconds', () => {
    const step = buildDelegationStep(
      row({ status: DelegationStatuses.Answered, durationMs: 180 }),
    );

    expect(step.detail).toContain('180 ms');
  });

  it('still names the peer when it advertised no matching skill', () => {
    const step = buildDelegationStep(row({ matchedSkills: [] }));

    expect(step.detail).toContain('**Peer:** Support Bot');
    expect(step.delegation?.matchedSkills).toEqual([]);
  });
});

describe('causeText', () => {
  it('has words for every failure this feature can produce', () => {
    for (const code of Object.values(DelegationErrorCodes)) {
      const text = causeText(code);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/PEER_/);
    }
  });

  it('falls back to something sayable when there is no code', () => {
    expect(causeText(null)).toBe('it did not answer');
  });
});
