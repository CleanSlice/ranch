import { describe, expect, test } from 'bun:test';
import type { IAgentMetrics } from '#agent/domain/agent.types';
import type { IAgentLoad } from '#agent/domain/agentLimit.types';
import type { IAgentPodStatus } from '#agent/domain/agentStatus.types';
import { agentSummary, type ISummaryInput } from './agentSummary';

const pod = (over: Partial<IAgentPodStatus> = {}): IAgentPodStatus => ({
  agentId: 'agent-1',
  podName: 'agent-1-pod',
  phase: 'Running',
  ready: true,
  restartCount: 0,
  startedAt: '2026-11-03T10:00:00.000Z',
  lastTerminationReason: null,
  containerWaitingReason: null,
  message: null,
  observedAt: '2026-11-03T10:05:00.000Z',
  ...over,
});

const metrics = (over: Partial<IAgentMetrics['pod']> = {}): IAgentMetrics => ({
  pod: {
    cpuMilli: 500,
    memBytes: 1024 * 1024 * 1024,
    cpuLimitMilli: 2000,
    memLimitBytes: 2 * 1024 * 1024 * 1024,
    ...over,
  },
  node: { name: 'node-1', diskAvailBytes: 10, diskCapacityBytes: 100 },
});

const load = (over: Partial<IAgentLoad> = {}): IAgentLoad => ({
  limits: { perMinute: 60, perHour: null, perDay: null },
  isPublic: true,
  needsLimits: false,
  windows: [
    { window: 'minute', used: 3, limit: 60, retryAfterSec: null },
    { window: 'hour', used: 40, limit: null, retryAfterSec: null },
    { window: 'day', used: 400, limit: null, retryAfterSec: null },
  ],
  inFlight: 0,
  series: [
    { minute: '2026-11-03T10:00:00.000Z', accepted: 2, refused: 0, exempt: 0 },
    { minute: '2026-11-03T10:01:00.000Z', accepted: 7, refused: 0, exempt: 1 },
    { minute: '2026-11-03T10:02:00.000Z', accepted: 3, refused: 0, exempt: 0 },
  ],
  refused: { lastHour: 0, lastAt: null, byWindow: { minute: 0, hour: 0, day: 0 } },
  exemptLastHour: 1,
  peaks: { minute: 20, hour: 300, day: 2000 },
  apiReplicas: 1,
  ...over,
});

const input = (over: Partial<ISummaryInput> = {}): ISummaryInput => ({
  agent: { status: 'running', statusReason: null, updatedAt: '2026-11-03T10:00:00.000Z' },
  pod: pod(),
  metrics: metrics(),
  usage: { totals: { inputTokens: 132600000, outputTokens: 5000, callCount: 2191, costUsd: 15.31 } },
  load: load(),
  ...over,
});

describe('agentSummary — status', () => {
  test('a running agent with a ready pod', () => {
    expect(agentSummary(input()).status).toEqual({
      state: 'ok',
      status: 'running',
      label: 'Running',
      tone: 'ok',
      podText: 'Pod ready',
      restarts: 0,
      reason: null,
      updatedAt: '2026-11-03T10:00:00.000Z',
    });
  });

  test('says stopped and failed in words, with the reason', () => {
    const stopped = agentSummary(
      input({ agent: { status: 'stopped', statusReason: null, updatedAt: 'x' }, pod: null }),
    ).status;
    expect(stopped.label).toBe('Stopped');
    expect(stopped.tone).toBe('off');
    expect(stopped.podText).toBe('No pod');

    const failed = agentSummary(
      input({
        agent: { status: 'failed', statusReason: 'Image pull failed', updatedAt: 'x' },
        pod: pod({ phase: 'Pending', ready: false, containerWaitingReason: 'ImagePullBackOff', restartCount: 4 }),
      }),
    ).status;
    expect(failed.label).toBe('Failed');
    expect(failed.tone).toBe('bad');
    expect(failed.podText).toBe('ImagePullBackOff');
    expect(failed.restarts).toBe(4);
    expect(failed.reason).toBe('Image pull failed');
  });

  test('a pod that runs but is not ready yet is starting', () => {
    const cell = agentSummary(
      input({
        agent: { status: 'deploying', statusReason: null, updatedAt: 'x' },
        pod: pod({ ready: false }),
      }),
    ).status;
    expect(cell.label).toBe('Deploying');
    expect(cell.tone).toBe('busy');
    expect(cell.podText).toBe('Pod starting');
  });

  test('is never unavailable', () => {
    const cell = agentSummary(input({ pod: null, metrics: null, usage: null, load: null })).status;
    expect(cell.state).toBe('ok');
  });
});

describe('agentSummary — spend', () => {
  test('cost, calls and input tokens of the 30 days', () => {
    expect(agentSummary(input()).spend).toEqual({
      state: 'ok',
      costUsd: 15.31,
      calls: 2191,
      inputTokens: 132600000,
    });
  });

  test('unavailable when usage did not load, and only this cell', () => {
    const summary = agentSummary(input({ usage: null }));
    expect(summary.spend).toEqual({ state: 'unavailable', text: 'Usage is not available' });
    expect(summary.pod.state).toBe('ok');
    expect(summary.requests.state).toBe('ok');
  });
});

describe('agentSummary — pod load', () => {
  test('used against allotted, as a share', () => {
    expect(agentSummary(input()).pod).toEqual({
      state: 'ok',
      cpu: { used: 500, limit: 2000, pct: 25 },
      memory: { used: 1024 * 1024 * 1024, limit: 2 * 1024 * 1024 * 1024, pct: 50 },
    });
  });

  test('a share never leaves 0–100', () => {
    const cell = agentSummary(input({ metrics: metrics({ cpuMilli: 5000, memBytes: -1 }) })).pod;
    expect(cell.state).toBe('ok');
    if (cell.state !== 'ok') return;
    expect(cell.cpu?.pct).toBe(100);
    expect(cell.memory?.pct).toBe(0);
  });

  test('no limits reported is unavailable, never 0 %', () => {
    const cell = agentSummary(
      input({ metrics: metrics({ cpuLimitMilli: 0, memLimitBytes: 0 }) }),
    ).pod;
    expect(cell).toEqual({
      state: 'unavailable',
      text: 'Not available — the pod reports no limits',
    });
  });

  test('one limit reported: that one is drawn, the other is not', () => {
    const cell = agentSummary(input({ metrics: metrics({ cpuLimitMilli: 0 }) })).pod;
    expect(cell.state).toBe('ok');
    if (cell.state !== 'ok') return;
    expect(cell.cpu).toBe(null);
    expect(cell.memory?.pct).toBe(50);
  });

  test('no pod is unavailable', () => {
    const cell = agentSummary(input({ pod: null })).pod;
    expect(cell).toEqual({ state: 'unavailable', text: 'Not available — there is no pod' });
  });

  test('a stopped agent is unavailable even with a stale reading', () => {
    const cell = agentSummary(
      input({ agent: { status: 'stopped', statusReason: null, updatedAt: 'x' } }),
    ).pod;
    expect(cell).toEqual({
      state: 'unavailable',
      text: 'Not available — the agent is stopped',
    });
  });

  test('a failed metrics request is unavailable, and only this cell', () => {
    const summary = agentSummary(input({ metrics: null }));
    expect(summary.pod).toEqual({ state: 'unavailable', text: 'Pod load is not available' });
    expect(summary.spend.state).toBe('ok');
    expect(summary.requests.state).toBe('ok');
  });
});

describe('agentSummary — requests', () => {
  test('the minute window against its limit, and the hour\'s peak', () => {
    expect(agentSummary(input()).requests).toEqual({
      state: 'ok',
      used: 3,
      limit: 60,
      limitText: 'of 60 allowed',
      peakThisHour: 7,
      refusedThisHour: 0,
      detail: 'Peak this hour: 7 per minute',
    });
  });

  test('refusals this hour replace the peak', () => {
    const cell = agentSummary(
      input({
        load: load({
          refused: { lastHour: 1234, lastAt: 'x', byWindow: { minute: 1234, hour: 0, day: 0 } },
        }),
      }),
    ).requests;
    expect(cell.state).toBe('ok');
    if (cell.state !== 'ok') return;
    expect(cell.refusedThisHour).toBe(1234);
    expect(cell.detail).toBe('1,234 refused this hour');
  });

  test('says there is no limit per minute', () => {
    const cell = agentSummary(
      input({
        load: load({
          limits: { perMinute: null, perHour: 300, perDay: null },
          windows: [
            { window: 'minute', used: 5, limit: null, retryAfterSec: null },
            { window: 'hour', used: 40, limit: 300, retryAfterSec: null },
          ],
        }),
      }),
    ).requests;
    expect(cell.state).toBe('ok');
    if (cell.state !== 'ok') return;
    expect(cell.used).toBe(5);
    expect(cell.limit).toBe(null);
    expect(cell.limitText).toBe('no limit per minute');
  });

  test('limits off altogether', () => {
    const cell = agentSummary(input({ load: load({ limits: null, windows: [], series: [] }) })).requests;
    expect(cell.state).toBe('ok');
    if (cell.state !== 'ok') return;
    expect(cell.used).toBe(0);
    expect(cell.limitText).toBe('no limit per minute');
    expect(cell.detail).toBe('Peak this hour: 0 per minute');
  });

  test('unavailable when the load did not come, and only this cell', () => {
    const summary = agentSummary(input({ load: null }));
    expect(summary.requests).toEqual({
      state: 'unavailable',
      text: 'Request load is not available',
    });
    expect(summary.spend.state).toBe('ok');
    expect(summary.pod.state).toBe('ok');
  });
});
