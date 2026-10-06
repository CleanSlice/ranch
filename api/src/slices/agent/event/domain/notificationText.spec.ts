import {
  IClosedNotificationPayload,
  IOpenedNotificationPayload,
} from './agentEvent.types';
import {
  escapeSlack,
  formatSpan,
  renderClosed,
  renderOpened,
} from './notificationText';

const CONSOLE = 'https://admin.ranch.example';

const opened = (
  over: Partial<IOpenedNotificationPayload> = {},
): IOpenedNotificationPayload => ({
  kind: 'opened',
  agentId: 'agent-1',
  agentName: 'Support Bot',
  status: 'failed',
  reason: 'CrashLoopBackOff',
  occurredAt: '2026-10-06T21:14:03.000Z',
  witness: 'external',
  senderName: 'cluster-watcher',
  tool: 'kubernetes-event-exporter',
  ranchStatus: 'failed',
  ...over,
});

const bodyOf = (m: { blocks: unknown[] }): string =>
  (m.blocks[0] as { text: { text: string } }).text.text;

describe('renderOpened', () => {
  it('names the agent, the cause, the moment, the witness and what Ranch sees', () => {
    const message = renderOpened(opened(), CONSOLE);
    const body = bodyOf(message);

    expect(message.text).toBe('Agent failed: Support Bot');
    expect(body).toContain('*Agent failed: Support Bot*');
    expect(body).toContain('*Cause:* CrashLoopBackOff');
    // Each reader sees their own time zone; the ISO string is the fallback.
    expect(body).toContain(
      '<!date^1791321243^{date_short_pretty} at {time}|2026-10-06T21:14:03.000Z>',
    );
    expect(body).toContain(
      '*Reported by:* cluster-watcher (via kubernetes-event-exporter)',
    );
    expect(body).toContain('*Ranch sees:* failed');
    expect(body).not.toContain('disagree');
    expect(body).toContain(
      `<${CONSOLE}/agents/agent-1?tab=events|Open in Ranch>`,
    );
  });

  it('says so when the outside sender and Ranch disagree', () => {
    const body = bodyOf(renderOpened(opened({ ranchStatus: 'running' }), CONSOLE));

    expect(body).toContain('*Ranch sees:* running — the two disagree');
  });

  it("reads differently for Ranch's own watch: no tool, no second opinion", () => {
    const body = bodyOf(
      renderOpened(
        opened({ witness: 'ranch', senderName: 'Ranch', tool: null }),
        CONSOLE,
      ),
    );

    expect(body).toContain('*Reported by:* Ranch (its own watch)');
    expect(body).not.toContain('Ranch sees');
  });

  it('says unreachable when that is what happened', () => {
    const message = renderOpened(
      opened({ status: 'unreachable', witness: 'ranch' }),
      CONSOLE,
    );

    expect(message.text).toBe('Agent unreachable: Support Bot');
  });

  it('leaves out the cause when there is none, and the link when the console address is unknown', () => {
    const body = bodyOf(renderOpened(opened({ reason: null }), null));

    expect(body).not.toContain('Cause');
    expect(body).not.toContain('Open in Ranch');
  });

  it("shows a sender's text as sent and lets it do nothing else", () => {
    const body = bodyOf(
      renderOpened(
        opened({
          agentName: 'A <b> & C',
          reason: '<!channel> see <http://evil.example|the fix> & more',
          senderName: '<!here>',
          tool: '<@U123>',
        }),
        CONSOLE,
      ),
    );

    // Nothing a sender wrote survives as a Slack command or link…
    expect(body).not.toContain('<!channel>');
    expect(body).not.toContain('<!here>');
    expect(body).not.toContain('<@U123>');
    expect(body).not.toContain('<http://evil.example|');
    // …and every character of it is still there to read.
    expect(body).toContain(
      '&lt;!channel&gt; see &lt;http://evil.example|the fix&gt; &amp; more',
    );
    expect(body).toContain('A &lt;b&gt; &amp; C');
  });

  it('cuts a very long cause so the message still fits a Slack block', () => {
    const body = bodyOf(renderOpened(opened({ reason: 'x'.repeat(2000) }), CONSOLE));

    expect(body.length).toBeLessThan(3000);
    expect(body).toContain('…');
  });
});

describe('renderClosed', () => {
  const closed = (
    over: Partial<IClosedNotificationPayload> = {},
  ): IClosedNotificationPayload => ({
    kind: 'closed',
    agentId: 'agent-1',
    agentName: 'Support Bot',
    resolution: 'recovered',
    openedAt: '2026-10-06T21:14:00.000Z',
    upAt: '2026-10-06T21:30:00.000Z',
    firstSenderName: 'cluster-watcher',
    ...over,
  });

  it('says the agent is back, how long it was down and that it held', () => {
    const message = renderClosed(closed());
    const body = bodyOf(message);

    expect(message.text).toBe('Agent back: Support Bot');
    expect(body).toContain('Down for 16 min');
    expect(body).toContain('up and stable for 10 min');
  });

  it('does not claim a recovery Ranch never saw the need for', () => {
    const message = renderClosed(closed({ resolution: 'unconfirmed' }));
    const body = bodyOf(message);

    expect(message.text).toBe('No further reports: Support Bot');
    expect(body).toContain('cluster-watcher reported a failure at');
    expect(body).toContain('Ranch saw the agent running throughout');
    expect(body).not.toContain('Down for');
  });
});

describe('formatSpan', () => {
  it.each([
    [0, '0 s'],
    [45_000, '45 s'],
    [16 * 60_000, '16 min'],
    [2 * 3_600_000, '2 h'],
    [2 * 3_600_000 + 5 * 60_000, '2 h 5 min'],
    [3 * 86_400_000 + 4 * 3_600_000, '3 d 4 h'],
    [-5_000, '0 s'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatSpan(ms)).toBe(text);
  });
});

describe('escapeSlack', () => {
  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    expect(escapeSlack('<&>')).toBe('&lt;&amp;&gt;');
  });
});
