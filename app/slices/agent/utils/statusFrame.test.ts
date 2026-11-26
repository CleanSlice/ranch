import { describe, expect, test } from 'bun:test';
import { frameIsNewer, parseStatusMessage } from './statusFrame';

const frame = (over: Record<string, unknown> = {}) => ({
  agent: { id: 'a1', status: 'deploying', updatedAt: '2026-11-26T10:00:00.000Z' },
  pod: { phase: 'Pending', ready: false, restartCount: 0, containerWaitingReason: 'ContainerCreating' },
  bridleConnected: false,
  tools: null,
  ...over,
});

describe('parseStatusMessage', () => {
  test('a snapshot is every agent it names', () => {
    const message = parseStatusMessage({
      type: 'snapshot',
      payload: [frame(), frame({ agent: { id: 'a2', status: 'running', updatedAt: 'x' }, pod: null, bridleConnected: true })],
    });
    expect(message?.snapshot).toBe(true);
    expect(message?.frames).toEqual([
      {
        agentId: 'a1',
        status: 'deploying',
        updatedAt: '2026-11-26T10:00:00.000Z',
        pod: {
          phase: 'Pending',
          ready: false,
          containerWaitingReason: 'ContainerCreating',
          superseded: false,
        },
        hubConnected: false,
      },
      { agentId: 'a2', status: 'running', updatedAt: 'x', pod: null, hubConnected: true },
    ]);
  });

  test('an event is one frame', () => {
    const message = parseStatusMessage({
      type: 'event',
      payload: { eventType: 'modified', status: frame({ pod: { phase: 'Running', ready: true } }) },
    });
    expect(message?.snapshot).toBe(false);
    expect(message?.frames[0]?.pod).toEqual({
      phase: 'Running',
      ready: true,
      containerWaitingReason: null,
      superseded: false,
    });
  });

  test('the server marks the pod of a replaced launch', () => {
    const message = parseStatusMessage({
      type: 'event',
      payload: {
        eventType: 'modified',
        status: frame({ pod: { phase: 'Running', ready: true, superseded: true } }),
      },
    });
    expect(message?.frames[0]?.pod?.superseded).toBe(true);
  });

  test('a deleted pod is no pod, whatever its last frame said', () => {
    const message = parseStatusMessage({
      type: 'event',
      payload: { eventType: 'deleted', status: frame({ pod: { phase: 'Running', ready: true } }) },
    });
    expect(message?.frames[0]?.pod).toBe(null);
  });

  test('the API wrapper around a frame is read through', () => {
    const message = parseStatusMessage({ data: { type: 'snapshot', payload: [frame()] } });
    expect(message?.frames.length).toBe(1);
  });

  test('what is not a frame is dropped, not guessed at', () => {
    expect(parseStatusMessage(null)).toBe(null);
    expect(parseStatusMessage('snapshot')).toBe(null);
    expect(parseStatusMessage({ type: 'other' })).toBe(null);
    expect(parseStatusMessage({ type: 'event', payload: { eventType: 'modified', status: {} } })).toBe(null);
    expect(parseStatusMessage({ type: 'snapshot', payload: [{ agent: {} }, frame()] })?.frames.length).toBe(1);
  });
});

describe('frameIsNewer', () => {
  test('only a strictly later frame is news', () => {
    expect(frameIsNewer('2026-11-26T10:00:01.000Z', '2026-11-26T10:00:00.000Z')).toBe(true);
    expect(frameIsNewer('2026-11-26T10:00:00.000Z', '2026-11-26T10:00:00.000Z')).toBe(false);
    expect(frameIsNewer('2026-11-26T09:59:59.000Z', '2026-11-26T10:00:00.000Z')).toBe(false);
  });

  test('a date that cannot be read is not news', () => {
    expect(frameIsNewer('', '2026-11-26T10:00:00.000Z')).toBe(false);
    expect(frameIsNewer('2026-11-26T10:00:00.000Z', '')).toBe(false);
  });
});
