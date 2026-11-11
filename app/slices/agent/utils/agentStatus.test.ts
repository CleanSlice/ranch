import { describe, expect, test } from 'bun:test';
import { agentInitials, agentStatusMeta, LEGEND_STATUSES } from './agentStatus';

describe('agentStatusMeta', () => {
  test('the five known statuses carry a wording key and their own colour', () => {
    expect(agentStatusMeta('running')).toEqual({
      labelKey: 'status.running',
      color: '#2fa66b',
      pulse: false,
      alarm: false,
    });
    expect(agentStatusMeta('deploying').pulse).toBe(true);
    expect(agentStatusMeta('pending').pulse).toBe(true);
    expect(agentStatusMeta('failed').alarm).toBe(true);
    expect(agentStatusMeta('failed').color).toBe('#d6453d');
    expect(agentStatusMeta('stopped')).toEqual({
      labelKey: 'status.stopped',
      color: '#7e7488',
      pulse: false,
      alarm: false,
    });
  });

  test('a status without wording is neutral and keeps no key, so the raw text is shown', () => {
    const unknown = agentStatusMeta('unreachable');
    expect(unknown.labelKey).toBe(null);
    expect(unknown.color).toBe('#7e7488');
    expect(unknown.pulse).toBe(false);
    expect(unknown.alarm).toBe(false);
    expect(agentStatusMeta(undefined)).toEqual(unknown);
  });

  test('the legend lists statuses live first, stopped last', () => {
    expect(LEGEND_STATUSES).toEqual(['running', 'deploying', 'pending', 'failed', 'stopped']);
  });
});

describe('agentInitials', () => {
  test('one word gives one letter, two or more give the first two', () => {
    expect(agentInitials('Rancher', 'id')).toBe('R');
    expect(agentInitials('OneMazda Intra', 'id')).toBe('OI');
    expect(agentInitials('Village Dental Manager', 'id')).toBe('VD');
  });

  test('upper-cases and survives extra whitespace', () => {
    expect(agentInitials('  nes   dennis  ', 'id')).toBe('ND');
  });

  test('a blank name falls back to the id, and a blank id to a question mark', () => {
    expect(agentInitials('', 'agent-7f2c')).toBe('A');
    expect(agentInitials(undefined, 'xyz')).toBe('X');
    expect(agentInitials('   ', '')).toBe('?');
  });
});
