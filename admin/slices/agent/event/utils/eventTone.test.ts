import { describe, expect, test } from 'bun:test';
import type { IIncidentNotification } from '../domain/agentEvent.types';
import {
  KNOWN_OUTCOMES,
  deliveryState,
  isNotNotified,
  outcomeTone,
  statusTone,
} from './eventTone';

const note = (over: Partial<IIncidentNotification> = {}): IIncidentNotification => ({
  kind: 'opened',
  status: 'sent',
  attempts: 1,
  sentAt: '2026-10-06T10:00:00Z',
  lastError: null,
  ...over,
});

describe('outcomeTone', () => {
  test('every outcome the API documents has a label of its own', () => {
    expect(KNOWN_OUTCOMES).toEqual([
      'opened',
      'joined',
      'suppressed_stopped',
      'suppressed_starting',
      'unmatched',
      'evidence',
    ]);
    for (let i = 0; i < KNOWN_OUTCOMES.length; i += 1) {
      const outcome = KNOWN_OUTCOMES[i]!;
      const { label } = outcomeTone(outcome);
      expect(label.length > 0).toBe(true);
      expect(label === outcome).toBe(false);
    }
  });

  test('the labels are the ones in the console contract', () => {
    expect(outcomeTone('opened').label).toBe('Opened an incident');
    expect(outcomeTone('joined').label).toBe('Same incident');
    expect(outcomeTone('suppressed_stopped').label).toBe('Agent was stopped on purpose');
    expect(outcomeTone('suppressed_starting').label).toBe('Agent was being started');
    expect(outcomeTone('unmatched').label).toBe('Unknown agent');
    expect(outcomeTone('evidence').label).toBe('Recovery reported');
  });

  test('an outcome this console does not know is shown raw, never blank', () => {
    expect(outcomeTone('escalated')).toEqual({ label: 'escalated', tone: 'muted' });
  });
});

describe('statusTone', () => {
  test('labels the three statuses and shows anything else raw', () => {
    expect(statusTone('failed')).toEqual({ label: 'Failed', tone: 'danger' });
    expect(statusTone('unreachable')).toEqual({ label: 'Unreachable', tone: 'warning' });
    expect(statusTone('recovered')).toEqual({ label: 'Recovered', tone: 'success' });
    expect(statusTone('degraded').label).toBe('degraded');
  });
});

describe('deliveryState', () => {
  test('no notification row means nothing to claim', () => {
    expect(deliveryState([])).toBe(null);
    expect(deliveryState(null)).toBe(null);
    expect(deliveryState([note({ kind: 'closed' })])).toBe(null);
  });

  test('sent is Notified', () => {
    expect(deliveryState([note()])).toEqual({ state: 'sent', label: 'Notified', tone: 'success' });
  });

  test('pending is Sending until an attempt has failed, then Retrying (n)', () => {
    expect(deliveryState([note({ status: 'pending', attempts: 0 })])?.label).toBe('Sending');
    expect(deliveryState([note({ status: 'pending', attempts: 2 })])?.label).toBe('Retrying (2)');
  });

  test('failed is Not delivered and carries the error as received', () => {
    const state = deliveryState([
      note({ status: 'failed', attempts: 5, lastError: 'HTTP 404 no_team' }),
    ]);
    expect(state?.label).toBe('Not delivered');
    expect(state?.tone).toBe('danger');
    expect(state?.detail).toBe('HTTP 404 no_team');
  });

  test('skipped is No destination', () => {
    expect(deliveryState([note({ status: 'skipped', attempts: 0 })])?.label).toBe('No destination');
  });

  test('reads the message for the kind asked for', () => {
    const rows = [note(), note({ kind: 'closed', status: 'failed', lastError: 'boom' })];
    expect(deliveryState(rows)?.label).toBe('Notified');
    expect(deliveryState(rows, 'closed')?.label).toBe('Not delivered');
  });
});

describe('isNotNotified', () => {
  test('is true only when the message did not and will not arrive', () => {
    expect(isNotNotified(deliveryState([note({ status: 'failed' })]))).toBe(true);
    expect(isNotNotified(deliveryState([note({ status: 'skipped' })]))).toBe(true);
    expect(isNotNotified(deliveryState([note({ status: 'pending' })]))).toBe(false);
    expect(isNotNotified(deliveryState([note()]))).toBe(false);
    expect(isNotNotified(null)).toBe(false);
  });
});
