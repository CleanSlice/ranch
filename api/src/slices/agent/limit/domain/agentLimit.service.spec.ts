import { IAgentLimitGateway, IAgentLimitRow } from './agentLimit.gateway';
import { AgentLimitService } from './agentLimit.service';
import {
  AgentLimitState,
  IAgentLimits,
  IAgentLoadMinute,
} from './agentLimit.types';

const MIN = 60_000;
const HOUR = 60 * MIN;
// On a minute boundary, so "this minute" in a test is unambiguous.
const T0 = Math.floor(1_800_000_000_000 / MIN) * MIN;

const limits = (l: Partial<IAgentLimits>): IAgentLimits => ({
  perMinute: null,
  perHour: null,
  perDay: null,
  ...l,
});

/** In-memory stand-in for the two tables. */
function makeGateway(seed: { rows?: IAgentLimitRow[] } = {}) {
  const rows = new Map<string, IAgentLimits>(
    (seed.rows ?? []).map((r) => [r.agentId, r.limits]),
  );
  const minutes = new Map<string, Map<number, IAgentLoadMinute>>();
  const state = { failWrites: null as null | { code?: string } };

  const gateway: IAgentLimitGateway = {
    findAll: () =>
      Promise.resolve(
        [...rows].map(([agentId, l]) => ({ agentId, limits: l })),
      ),
    upsert: (agentId, l) => {
      rows.set(agentId, l);
      return Promise.resolve();
    },
    remove: (agentId) => {
      rows.delete(agentId);
      return Promise.resolve();
    },
    addMinutes: (agentId, batch) => {
      if (state.failWrites) {
        return Promise.reject(
          Object.assign(new Error('write failed'), state.failWrites),
        );
      }
      const mine = minutes.get(agentId) ?? new Map<number, IAgentLoadMinute>();
      minutes.set(agentId, mine);
      for (const m of batch) {
        const have = mine.get(m.minute);
        if (!have) mine.set(m.minute, { ...m });
        else {
          have.accepted += m.accepted;
          have.refused += m.refused;
          have.refusedByMinute += m.refusedByMinute;
          have.refusedByHour += m.refusedByHour;
          have.refusedByDay += m.refusedByDay;
          have.exempt += m.exempt;
        }
      }
      return Promise.resolve();
    },
    minutes: (agentId, sinceMs) =>
      Promise.resolve(
        [...(minutes.get(agentId)?.values() ?? [])]
          .filter((m) => m.minute >= sinceMs)
          .sort((a, b) => a.minute - b.minute)
          .map((m) => ({ ...m })),
      ),
    pruneBefore: () => Promise.resolve(),
  };

  const stored = (agentId: string) =>
    [...(minutes.get(agentId)?.values() ?? [])].sort(
      (a, b) => a.minute - b.minute,
    );
  const put = (
    agentId: string,
    m: Partial<IAgentLoadMinute> & { minute: number },
  ) => {
    const mine = minutes.get(agentId) ?? new Map<number, IAgentLoadMinute>();
    minutes.set(agentId, mine);
    mine.set(m.minute, {
      accepted: 0,
      refused: 0,
      refusedByMinute: 0,
      refusedByHour: 0,
      refusedByDay: 0,
      exempt: 0,
      ...m,
    });
  };
  return { gateway, rows, stored, put, state };
}

function makeHub() {
  const sent: Array<{ agentId: string; state: AgentLimitState }> = [];
  return {
    sent,
    hub: {
      inFlight: () => 2,
      broadcast: (agentId: string, state: AgentLimitState) => {
        sent.push({ agentId, state });
      },
    },
  };
}

async function make(seed: { rows?: IAgentLimitRow[] } = {}) {
  const g = makeGateway(seed);
  const service = new AgentLimitService(g.gateway);
  const h = makeHub();
  service.attachHub(h.hub);
  return { service, ...g, ...h };
}

describe('AgentLimitService', () => {
  describe('with limits off', () => {
    it('refuses nothing and still records the load', async () => {
      const { service, stored } = await make();
      for (let i = 0; i < 500; i++) {
        expect(service.check('a', 'visitor', T0 + i).admitted).toBe(true);
      }
      await service.flush();
      expect(stored('a')).toEqual([
        expect.objectContaining({ minute: T0, accepted: 500, refused: 0 }),
      ]);
    });

    it('announces nothing', async () => {
      const { service, sent } = await make();
      service.check('a', 'visitor', T0);
      expect(service.stateFor('a', T0)).toEqual({ limited: false });
      expect(sent).toEqual([]);
    });
  });

  describe('counting visitors', () => {
    it('admits up to the limit, then refuses with the wait, and does not count the refusal', async () => {
      const { service, stored } = await make();
      await service.setLimits('a', limits({ perMinute: 2 }), 'u1', T0);

      expect(service.check('a', 'visitor', T0 + 1_000).admitted).toBe(true);
      expect(service.check('a', 'visitor', T0 + 2_000).admitted).toBe(true);
      const third = service.check('a', 'visitor', T0 + 3_000);
      expect(third).toEqual({
        admitted: false,
        retryAfterMs: 58_000,
        window: 'minute',
      });
      // Hammering Send during the wait must not extend it.
      expect(service.check('a', 'visitor', T0 + 4_000)).toEqual({
        admitted: false,
        retryAfterMs: 57_000,
        window: 'minute',
      });

      await service.flush();
      expect(stored('a')[0]).toEqual(
        expect.objectContaining({
          accepted: 2,
          refused: 2,
          refusedByMinute: 2,
          refusedByHour: 0,
        }),
      );
    });

    it('accepts again once the stated wait has passed', async () => {
      const { service } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      service.check('a', 'visitor', T0 + 5_000);
      const refused = service.check('a', 'visitor', T0 + 6_000);
      if (refused.admitted) throw new Error('expected a refusal');
      expect(
        service.check('a', 'visitor', T0 + 6_000 + refused.retryAfterMs)
          .admitted,
      ).toBe(true);
    });

    it('keeps agents apart', async () => {
      const { service } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      await service.setLimits('b', limits({ perMinute: 1 }), null, T0);
      expect(service.check('a', 'visitor', T0).admitted).toBe(true);
      expect(service.check('b', 'visitor', T0).admitted).toBe(true);
      expect(service.check('a', 'visitor', T0 + 1).admitted).toBe(false);
    });

    it('treats a request with no stated source as a visitor', async () => {
      const { service } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      service.check('a', undefined, T0);
      expect(service.check('a', undefined, T0 + 1).admitted).toBe(false);
    });
  });

  describe('operators and other agents', () => {
    it('are never refused and never use up allowance', async () => {
      const { service, stored } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      for (let i = 0; i < 20; i++) {
        expect(service.check('a', 'operator', T0 + i).admitted).toBe(true);
        expect(service.check('a', 'peer', T0 + i).admitted).toBe(true);
      }
      // The visitor's allowance is untouched.
      expect(service.check('a', 'visitor', T0 + 100).admitted).toBe(true);
      // And an operator still gets through an agent that is at its limit.
      expect(service.check('a', 'visitor', T0 + 200).admitted).toBe(false);
      expect(service.check('a', 'operator', T0 + 300).admitted).toBe(true);

      await service.flush();
      expect(stored('a')[0]).toEqual(
        expect.objectContaining({ accepted: 1, refused: 1, exempt: 41 }),
      );
    });
  });

  describe('changing limits', () => {
    it('takes effect on the next request and keeps what was used', async () => {
      const { service } = await make();
      await service.setLimits('a', limits({ perHour: 100 }), null, T0);
      for (let i = 0; i < 80; i++)
        service.check('a', 'visitor', T0 + i * 1_000);

      await service.setLimits('a', limits({ perHour: 50 }), null, T0 + 2 * MIN);
      const d = service.check('a', 'visitor', T0 + 2 * MIN);
      expect(d.admitted).toBe(false);
      if (!d.admitted) expect(d.window).toBe('hour');

      await service.setLimits(
        'a',
        limits({ perHour: 200 }),
        null,
        T0 + 3 * MIN,
      );
      expect(service.check('a', 'visitor', T0 + 3 * MIN).admitted).toBe(true);
    });

    it('starts from real usage when limits are switched on for a busy agent', async () => {
      const { service } = await make();
      for (let i = 0; i < 10; i++) service.check('a', 'visitor', T0 + i);
      await service.setLimits('a', limits({ perHour: 10 }), null, T0 + MIN);
      expect(service.check('a', 'visitor', T0 + MIN).admitted).toBe(false);
    });

    it('stops refusing when limits are removed', async () => {
      const { service, rows } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      service.check('a', 'visitor', T0);
      expect(service.check('a', 'visitor', T0 + 1).admitted).toBe(false);

      await service.setLimits('a', null, null, T0 + 2);
      expect(rows.has('a')).toBe(false);
      expect(service.getLimits('a')).toBeNull();
      expect(service.check('a', 'visitor', T0 + 3).admitted).toBe(true);
    });

    it('treats limits with every window empty as off', async () => {
      const { service, rows } = await make();
      await service.setLimits('a', limits({}), null, T0);
      expect(rows.has('a')).toBe(false);
      expect(service.getLimits('a')).toBeNull();
    });
  });

  describe('telling open chats', () => {
    it('announces an hour window once, when it fills', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perHour: 2 }), null, T0);
      sent.length = 0;

      service.check('a', 'visitor', T0 + 1_000);
      expect(sent).toEqual([]);
      service.check('a', 'visitor', T0 + 2_000);
      expect(sent).toEqual([
        {
          agentId: 'a',
          state: { limited: true, retryAfterMs: HOUR - 1_000, window: 'hour' },
        },
      ]);
      // Refusals after that do not announce again.
      service.check('a', 'visitor', T0 + 3_000);
      expect(sent).toHaveLength(1);
      expect(service.stateFor('a', T0 + 3_000)).toEqual({
        limited: true,
        retryAfterMs: HOUR - 2_000,
        window: 'hour',
      });
    });

    it('never announces a minute window', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perMinute: 1 }), null, T0);
      sent.length = 0;
      service.check('a', 'visitor', T0);
      service.check('a', 'visitor', T0 + 1);
      expect(sent).toEqual([]);
      expect(service.stateFor('a', T0 + 1)).toEqual({ limited: false });
    });

    it('says nothing when a window frees by time, and announces the next fill', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perHour: 1 }), null, T0);
      sent.length = 0;
      service.check('a', 'visitor', T0);
      expect(sent).toHaveLength(1);

      expect(service.stateFor('a', T0 + HOUR)).toEqual({ limited: false });
      service.check('a', 'visitor', T0 + HOUR);
      expect(sent).toHaveLength(2);
      expect(sent.every((s) => s.state.limited)).toBe(true);
    });

    it('tells chats to stop waiting when a raised limit makes room', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perHour: 1 }), null, T0);
      service.check('a', 'visitor', T0);
      sent.length = 0;

      await service.setLimits('a', limits({ perHour: 5 }), null, T0 + 1_000);
      expect(sent).toEqual([{ agentId: 'a', state: { limited: false } }]);
    });

    it('tells chats to stop waiting when limits are removed', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perHour: 1 }), null, T0);
      service.check('a', 'visitor', T0);
      sent.length = 0;
      await service.setLimits('a', null, null, T0 + 1_000);
      expect(sent).toEqual([{ agentId: 'a', state: { limited: false } }]);
    });

    it('announces at once when a lowered limit is already full', async () => {
      const { service, sent } = await make();
      await service.setLimits('a', limits({ perHour: 10 }), null, T0);
      for (let i = 0; i < 5; i++) service.check('a', 'visitor', T0 + i);
      sent.length = 0;
      await service.setLimits('a', limits({ perHour: 3 }), null, T0 + 1_000);
      expect(sent).toHaveLength(1);
      expect(sent[0].state.limited).toBe(true);
    });

    it('does not call off the wait while the minute window is still full', async () => {
      const { service, sent } = await make();
      await service.setLimits(
        'a',
        limits({ perMinute: 1, perHour: 1 }),
        null,
        T0,
      );
      service.check('a', 'visitor', T0);
      sent.length = 0;
      await service.setLimits(
        'a',
        limits({ perMinute: 1, perHour: 9 }),
        null,
        T0 + 1_000,
      );
      expect(sent).toEqual([]);
    });
  });

  describe('surviving a restart', () => {
    it('writes pending counts on flush and on shutdown', async () => {
      const { service, stored } = await make();
      service.check('a', 'visitor', T0);
      service.check('a', 'visitor', T0 + MIN);
      expect(stored('a')).toEqual([]);
      await service.onModuleDestroy();
      expect(stored('a').map((m) => [m.minute, m.accepted])).toEqual([
        [T0, 1],
        [T0 + MIN, 1],
      ]);
    });

    it('does not write the same counts twice', async () => {
      const { service, stored } = await make();
      service.check('a', 'visitor', T0);
      await Promise.all([service.flush(), service.flush()]);
      await service.flush();
      expect(stored('a')[0].accepted).toBe(1);
    });

    it('keeps counts for the next attempt when a write fails', async () => {
      const { service, stored, state } = await make();
      service.check('a', 'visitor', T0);
      state.failWrites = {};
      await service.flush();
      service.check('a', 'visitor', T0 + 1);
      state.failWrites = null;
      await service.flush();
      expect(stored('a')[0].accepted).toBe(2);
    });

    it('drops the counts of an agent that no longer exists', async () => {
      const { service, stored, state } = await make();
      service.check('gone', 'visitor', T0);
      state.failWrites = { code: 'P2003' };
      await service.flush();
      state.failWrites = null;
      await service.flush();
      expect(stored('gone')).toEqual([]);
    });

    it('rebuilds usage at boot, so a restart hands out no fresh allowance', async () => {
      const first = await make();
      await first.service.setLimits('a', limits({ perHour: 3 }), null, T0);
      for (let i = 0; i < 3; i++)
        first.service.check('a', 'visitor', T0 + i * MIN);
      await first.service.onModuleDestroy();

      // A new process over the same tables.
      const second = new AgentLimitService(first.gateway);
      jest.useFakeTimers({ now: T0 + 10 * MIN });
      try {
        await second.onModuleInit();
        expect(second.getLimits('a')).toEqual(limits({ perHour: 3 }));
        const d = second.check('a', 'visitor', T0 + 10 * MIN);
        expect(d.admitted).toBe(false);
        if (!d.admitted) {
          // The oldest request leaves at T0 + 1 h; rebuilt, at most a minute later.
          expect(d.retryAfterMs).toBeGreaterThanOrEqual(50 * MIN);
          expect(d.retryAfterMs).toBeLessThanOrEqual(51 * MIN);
        }
        expect(second.stateFor('a', T0 + 10 * MIN).limited).toBe(true);
      } finally {
        await second.onModuleDestroy();
        jest.useRealTimers();
      }
    });
  });

  describe('figures for the operator', () => {
    it('reports used against the limit and the wait per window', async () => {
      const { service } = await make();
      await service.setLimits(
        'a',
        limits({ perMinute: 2, perHour: 10 }),
        null,
        T0,
      );
      service.check('a', 'visitor', T0 + 1_000);
      service.check('a', 'visitor', T0 + 2_000);
      service.check('a', 'visitor', T0 + 3_000);

      const snap = await service.snapshot(
        { id: 'a', isPublic: true },
        T0 + 3_000,
      );
      expect(snap.limits).toEqual(limits({ perMinute: 2, perHour: 10 }));
      expect(snap.needsLimits).toBe(false);
      expect(snap.windows).toEqual([
        { window: 'minute', used: 2, limit: 2, retryAfterSec: 58 },
        { window: 'hour', used: 2, limit: 10, retryAfterSec: null },
        { window: 'day', used: 2, limit: null, retryAfterSec: null },
      ]);
      expect(snap.inFlight).toBe(2);
      expect(snap.refused).toEqual({
        lastHour: 1,
        lastAt: new Date(T0 + 3_000).toISOString(),
        byWindow: { minute: 1, hour: 0, day: 0 },
      });
      expect(snap.apiReplicas).toBe(1);
    });

    it('gives sixty minutes oldest first, with empty minutes filled in', async () => {
      const { service, put } = await make();
      put('a', { minute: T0 - 59 * MIN, accepted: 4 });
      put('a', { minute: T0 - 61 * MIN, accepted: 99 });
      service.check('a', 'visitor', T0 + 1);
      service.check('a', 'operator', T0 + 2);

      const snap = await service.snapshot({ id: 'a', isPublic: false }, T0 + 5);
      expect(snap.series).toHaveLength(60);
      expect(snap.series[0]).toEqual(
        expect.objectContaining({ minute: T0 - 59 * MIN, accepted: 4 }),
      );
      expect(snap.series[1].accepted).toBe(0);
      expect(snap.series[59]).toEqual(
        expect.objectContaining({ minute: T0, accepted: 1, exempt: 1 }),
      );
      expect(snap.exemptLastHour).toBe(1);
    });

    it('shows load with no ceiling for an agent with limits off', async () => {
      const { service, put } = await make();
      put('a', { minute: T0 - 30 * MIN, accepted: 7 });
      put('a', { minute: T0 - 5 * HOUR, accepted: 20 });
      service.check('a', 'visitor', T0 + 1);

      const snap = await service.snapshot({ id: 'a', isPublic: false }, T0 + 2);
      expect(snap.limits).toBeNull();
      expect(snap.windows).toEqual([
        { window: 'minute', used: 1, limit: null, retryAfterSec: null },
        { window: 'hour', used: 8, limit: null, retryAfterSec: null },
        { window: 'day', used: 28, limit: null, retryAfterSec: null },
      ]);
    });

    it('marks a public agent with no limits', async () => {
      const { service } = await make();
      const snap = await service.snapshot({ id: 'a', isPublic: true }, T0);
      expect(snap.needsLimits).toBe(true);
    });

    it('finds the highest minute, hour and day in the stored history', async () => {
      const { service, put } = await make();
      const day = 24 * HOUR;
      put('a', { minute: T0 - 3 * day, accepted: 5 });
      put('a', { minute: T0 - 3 * day + 30 * MIN, accepted: 6 });
      put('a', { minute: T0 - 3 * day + 2 * HOUR, accepted: 9 });
      put('a', { minute: T0 - 1 * day, accepted: 4 });

      const snap = await service.snapshot({ id: 'a', isPublic: false }, T0);
      expect(snap.peaks).toEqual({ minute: 9, hour: 11, day: 20 });
    });

    it('falls back to the stored minute for the last refusal after a restart', async () => {
      const { service, put } = await make();
      put('a', { minute: T0 - 10 * MIN, refused: 3, refusedByHour: 3 });
      const snap = await service.snapshot({ id: 'a', isPublic: false }, T0);
      expect(snap.refused.lastAt).toBe(new Date(T0 - 10 * MIN).toISOString());
      expect(snap.refused.byWindow.hour).toBe(3);
    });

    it('summarises every agent for the list', async () => {
      const { service } = await make();
      await service.setLimits('full', limits({ perMinute: 1 }), null, T0);
      service.check('full', 'visitor', T0);
      await service.setLimits('roomy', limits({ perMinute: 9 }), null, T0);

      expect(
        service.summary(
          [
            { id: 'full', isPublic: true },
            { id: 'roomy', isPublic: false },
            { id: 'legacy', isPublic: true },
            { id: 'plain', isPublic: false },
          ],
          T0 + 1,
        ),
      ).toEqual([
        { agentId: 'full', enabled: true, atLimit: true, needsLimits: false },
        { agentId: 'roomy', enabled: true, atLimit: false, needsLimits: false },
        {
          agentId: 'legacy',
          enabled: false,
          atLimit: false,
          needsLimits: true,
        },
        {
          agentId: 'plain',
          enabled: false,
          atLimit: false,
          needsLimits: false,
        },
      ]);
    });

    it('tells a pacing caller how much of the tightest window is left', async () => {
      const { service } = await make();
      expect(service.remainingFor('a', T0)).toBeNull();
      await service.setLimits(
        'a',
        limits({ perMinute: 5, perHour: 6 }),
        null,
        T0,
      );
      for (let i = 0; i < 4; i++) service.check('a', 'visitor', T0 + i * 1_000);
      expect(service.remainingFor('a', T0 + 10_000)).toEqual({
        remaining: 1,
        resetSec: 50,
      });
    });
  });
});
