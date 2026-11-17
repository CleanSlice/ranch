import { describe, expect, test } from 'bun:test';
import { agentCreatorView, keepKnownCreator } from './agentCreator';

describe('agentCreatorView', () => {
  test('a known account: its name and its email', () => {
    expect(
      agentCreatorView({ id: 'u-1', name: 'Ada Admin', email: 'ada@example.test' }),
    ).toEqual({ state: 'known', name: 'Ada Admin', email: 'ada@example.test' });
  });

  test('nobody recorded reads Unknown', () => {
    expect(agentCreatorView(null)).toEqual({ state: 'unknown', text: 'Unknown' });
    expect(agentCreatorView(undefined)).toEqual({ state: 'unknown', text: 'Unknown' });
  });

  test('an account that is gone reads Removed account', () => {
    expect(agentCreatorView({ id: 'u-gone', name: null, email: null })).toEqual({
      state: 'removed',
      text: 'Removed account',
    });
    expect(agentCreatorView({ id: 'u-gone', name: '  ', email: '' })).toEqual({
      state: 'removed',
      text: 'Removed account',
    });
  });

  test('an account with only an email is named by it, once', () => {
    expect(
      agentCreatorView({ id: 'u-2', name: null, email: 'bob@example.test' }),
    ).toEqual({ state: 'known', name: 'bob@example.test', email: null });
    expect(
      agentCreatorView({ id: 'u-2', name: 'bob@example.test', email: 'bob@example.test' }),
    ).toEqual({ state: 'known', name: 'bob@example.test', email: null });
  });

  test('an account with only a name has no email to show', () => {
    expect(agentCreatorView({ id: 'u-3', name: 'Cy', email: null })).toEqual({
      state: 'known',
      name: 'Cy',
      email: null,
    });
  });
});

describe('keepKnownCreator', () => {
  const ada = { id: 'u-1', name: 'Ada', email: 'ada@example.test' };
  interface IRow {
    id: string;
    status: string;
    createdBy?: typeof ada | null;
  }
  const row = (createdBy?: typeof ada | null): IRow => ({ id: 'agent-1', status: 'running', createdBy });
  /** A record decoded from a frame that does not carry the field. */
  const frame = (status: string): IRow => ({ id: 'agent-1', status });

  test('a frame that does not say keeps the creator the store holds', () => {
    const next = keepKnownCreator(frame('failed'), row(ada));
    expect(next).toEqual({ id: 'agent-1', status: 'failed', createdBy: ada });
  });

  test('and keeps "nobody" when that is what the store holds', () => {
    expect(keepKnownCreator(frame('failed'), row(null)).createdBy).toBe(null);
  });

  test('a record that says wins, in both directions', () => {
    expect(keepKnownCreator(row(null), row(ada)).createdBy).toBe(null);
    expect(keepKnownCreator(row(ada), row(null)).createdBy).toEqual(ada);
  });

  test('a first sighting with nothing said is nobody, never undefined', () => {
    const next = keepKnownCreator(frame('running'), undefined);
    expect('createdBy' in next).toBe(true);
    expect(next.createdBy).toBe(null);
  });

  test('a record that says is handed back as it is', () => {
    const incoming = row(ada);
    expect(keepKnownCreator(incoming, undefined)).toBe(incoming);
  });
});
