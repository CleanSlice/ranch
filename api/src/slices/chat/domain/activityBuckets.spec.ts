import { bucketByHour, hourOf } from './activityBuckets';

const at = (iso: string) => Date.parse(iso);

describe('bucketByHour', () => {
  it('counts both roles in the hour each message was sent', () => {
    const rows = bucketByHour([
      { role: 'user', ts: at('2026-11-20T09:05:00Z') },
      { role: 'assistant', ts: at('2026-11-20T09:05:40Z') },
      { role: 'user', ts: at('2026-11-20T09:59:59.999Z') },
      { role: 'assistant', ts: at('2026-11-20T10:00:30Z') },
      { role: 'user', ts: at('2026-11-20T10:20:00Z') },
      { role: 'assistant', ts: at('2026-11-20T10:21:00Z') },
      { role: 'assistant', ts: at('2026-11-21T23:30:00Z') },
    ]);

    expect(rows).toEqual([
      {
        hour: new Date('2026-11-20T09:00:00Z'),
        userMessages: 2,
        agentMessages: 1,
      },
      {
        hour: new Date('2026-11-20T10:00:00Z'),
        userMessages: 1,
        agentMessages: 2,
      },
      {
        hour: new Date('2026-11-21T23:00:00Z'),
        userMessages: 0,
        agentMessages: 1,
      },
    ]);
  });

  it('ignores every role that is not the person or the agent', () => {
    const rows = bucketByHour([
      { role: 'user', ts: at('2026-11-20T09:05:00Z') },
      { role: 'summary', ts: at('2026-11-20T09:06:00Z') },
      { role: 'tool_call', ts: at('2026-11-20T09:07:00Z') },
      { role: 'tool_result', ts: at('2026-11-20T09:08:00Z') },
      { role: 'system', ts: at('2026-11-20T11:00:00Z') },
    ]);

    expect(rows).toEqual([
      {
        hour: new Date('2026-11-20T09:00:00Z'),
        userMessages: 1,
        agentMessages: 0,
      },
    ]);
  });

  it('gives no rows for an empty list', () => {
    expect(bucketByHour([])).toEqual([]);
  });

  it('puts a message sent exactly on the hour into the hour it starts', () => {
    const rows = bucketByHour([
      { role: 'user', ts: at('2026-11-20T10:00:00.000Z') },
    ]);

    expect(rows).toEqual([
      {
        hour: new Date('2026-11-20T10:00:00Z'),
        userMessages: 1,
        agentMessages: 0,
      },
    ]);
  });

  it('gives the same rows, oldest hour first, whatever the input order', () => {
    const messages = [
      { role: 'assistant', ts: at('2026-11-22T03:10:00Z') },
      { role: 'user', ts: at('2026-11-20T09:05:00Z') },
      { role: 'user', ts: at('2026-11-22T03:09:00Z') },
      { role: 'assistant', ts: at('2026-11-20T09:06:00Z') },
      { role: 'user', ts: at('2026-11-21T15:00:00Z') },
    ];

    const sorted = [...messages].sort((a, b) => a.ts - b.ts);
    const reversed = [...sorted].reverse();

    expect(bucketByHour(messages)).toEqual(bucketByHour(sorted));
    expect(bucketByHour(reversed)).toEqual(bucketByHour(sorted));
    expect(bucketByHour(messages).map((r) => r.hour.toISOString())).toEqual([
      '2026-11-20T09:00:00.000Z',
      '2026-11-21T15:00:00.000Z',
      '2026-11-22T03:00:00.000Z',
    ]);
  });

  // A transcript line is runtime-authored input: a time that is not a number
  // has no hour, and must not become a row keyed by an invalid date.
  it('leaves out a message whose time is not a moment', () => {
    expect(bucketByHour([{ role: 'user', ts: Number.NaN }])).toEqual([]);
  });
});

describe('hourOf', () => {
  it('is the UTC start of the hour, whatever the zone of the machine', () => {
    expect(hourOf(at('2026-03-29T01:59:59.999Z'))).toEqual(
      new Date('2026-03-29T01:00:00.000Z'),
    );
    expect(hourOf(at('2026-03-29T02:00:00.000Z'))).toEqual(
      new Date('2026-03-29T02:00:00.000Z'),
    );
  });
});
