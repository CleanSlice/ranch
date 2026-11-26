import { describe, expect, test } from 'bun:test';
import { agentCreatorView, keepKnownCreator } from './agentCreator';

describe('agentCreatorView', () => {
  test('a known account: its name and its email', () => {
    expect(
      agentCreatorView({ id: 'u-1', name: 'Ada Admin', email: 'ada@example.test' }),
    ).toEqual({ state: 'known', you: false, name: 'Ada Admin', email: 'ada@example.test' });
  });

  test('the viewer’s own account is marked as theirs (CLEAN-259)', () => {
    expect(
      agentCreatorView({ id: 'u-1', name: 'Ada Admin', email: 'ada@example.test' }, true),
    ).toEqual({ state: 'known', you: true, name: 'Ada Admin', email: 'ada@example.test' });
    // Theirs even when no name came with the record.
    expect(agentCreatorView(null, true)).toEqual({ state: 'known', you: true, name: '', email: null });
    expect(agentCreatorView({ id: 'u-1', name: null, email: null }, true)).toEqual({
      state: 'known',
      you: true,
      name: '',
      email: null,
    });
  });

  test('nobody recorded says so', () => {
    expect(agentCreatorView(null)).toEqual({ state: 'unknown', text: 'Creator not recorded' });
    expect(agentCreatorView(undefined)).toEqual({ state: 'unknown', text: 'Creator not recorded' });
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
    ).toEqual({ state: 'known', you: false, name: 'bob@example.test', email: null });
    expect(
      agentCreatorView({ id: 'u-2', name: 'bob@example.test', email: 'bob@example.test' }),
    ).toEqual({ state: 'known', you: false, name: 'bob@example.test', email: null });
  });

  test('an account with only a name has no email to show', () => {
    expect(agentCreatorView({ id: 'u-3', name: 'Cy', email: null })).toEqual({
      state: 'known',
      you: false,
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
    createdByMe?: boolean;
  }
  /** A record from a route that resolves creators: it says both. */
  const row = (createdBy?: typeof ada | null, createdByMe = false): IRow => ({
    id: 'agent-1',
    status: 'running',
    createdBy,
    createdByMe,
  });
  /** A record decoded from a frame that does not carry the field. */
  const frame = (status: string): IRow => ({ id: 'agent-1', status });

  test('a frame that does not say keeps the creator the store holds', () => {
    const next = keepKnownCreator(frame('failed'), row(ada));
    expect(next).toEqual({ id: 'agent-1', status: 'failed', createdBy: ada, createdByMe: false });
  });

  test('and whether it is the viewer’s own (CLEAN-259)', () => {
    expect(keepKnownCreator(frame('failed'), row(ada, true)).createdByMe).toBe(true);
    // A first sighting with nothing said is not theirs, never undefined.
    expect(keepKnownCreator(frame('running'), undefined).createdByMe).toBe(false);
  });

  test('a status snapshot says whose it is and not who made it: each field on its own', () => {
    const snapshot: IRow = { id: 'agent-1', status: 'running', createdByMe: true };
    expect(keepKnownCreator(snapshot, row(ada, false))).toEqual({
      id: 'agent-1',
      status: 'running',
      createdBy: ada,
      createdByMe: true,
    });
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
