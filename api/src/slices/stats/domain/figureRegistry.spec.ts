import { captureBackgroundError } from '#/setup/sentry';
import { IFigureDefinition, IStatFigureData } from './figure.types';
import { FigureRegistry } from './figureRegistry';
import { IStatFigureGateway } from './statFigure.gateway';

jest.mock('#/setup/sentry', () => ({ captureBackgroundError: jest.fn() }));

const at = (iso: string) => new Date(iso);

const BOOT = at('2026-11-27T10:00:00.000Z');
const NEXT_BOOT = at('2026-12-05T10:00:00.000Z');

/** In-memory stand-in for the StatFigure table. */
function makeGateway(seed: Record<string, string> = {}) {
  const rows = new Map<string, IStatFigureData>(
    Object.entries(seed).map(([key, since]) => [
      key,
      { key, completeSince: at(since), updatedAt: at(since) },
    ]),
  );
  const gateway = {
    findAll: jest.fn(() => Promise.resolve([...rows.values()])),
    createIfAbsent: jest.fn((key: string, completeSince: Date) => {
      if (!rows.has(key)) {
        rows.set(key, { key, completeSince, updatedAt: new Date() });
      }
      return Promise.resolve();
    }),
    remove: jest.fn((key: string) => {
      rows.delete(key);
      return Promise.resolve();
    }),
  };
  const since = (key: string) => rows.get(key)?.completeSince.toISOString();
  return { gateway, rows, since };
}

/**
 * A figure kept in a table written for it: it names its rebuild, and says
 * how far back that table goes.
 */
function recorded(key: string, first: string | null) {
  const firstRecord = jest.fn(() => Promise.resolve(first ? at(first) : null));
  const def: IFigureDefinition = {
    key,
    scopes: ['personal'],
    firstRecord,
    rebuild: 'chat.settle',
  };
  return { def, firstRecord };
}

/** A figure whose rows are its source: no rebuild, and no first record. */
const readInPlace = (key: string): IFigureDefinition => ({
  key,
  scopes: ['personal'],
});

function makeRegistry(seed: Record<string, string> = {}) {
  const store = makeGateway(seed);
  const registry = new FigureRegistry(
    store.gateway as unknown as IStatFigureGateway,
  );
  // The boot path logs what it could not do; keep the test output clean.
  jest
    .spyOn(
      (registry as unknown as { logger: { error: () => void } }).logger,
      'error',
    )
    .mockImplementation(() => undefined);
  return { registry, ...store };
}

describe('FigureRegistry', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: BOOT });
    (captureBackgroundError as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('at boot, a recorded figure', () => {
    it('gets a row from its first record when it has none', async () => {
      const { registry, since } = makeRegistry();
      registry.register(recorded('refusals', '2026-10-30T00:00:00.000Z').def);

      await registry.onApplicationBootstrap();

      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
    });

    it('takes now when its source has no record yet', async () => {
      const { registry, since } = makeRegistry();
      registry.register(recorded('activity', null).def);

      await registry.onApplicationBootstrap();

      expect(since('activity')).toBe(BOOT.toISOString());
    });

    it('takes now when its definition names no first record', async () => {
      const { registry, since } = makeRegistry();
      registry.register({
        key: 'activity',
        scopes: ['personal'],
        rebuild: 'chat.settle',
      });

      await registry.onApplicationBootstrap();

      expect(since('activity')).toBe(BOOT.toISOString());
    });

    it('is left alone once it has a row, whatever its first record now is', async () => {
      const { registry, gateway, since } = makeRegistry({
        refusals: '2026-03-01T00:00:00.000Z',
        activity: '2026-06-01T00:00:00.000Z',
      });
      // An older record turned up, and a source that has since been emptied.
      const refusals = recorded('refusals', '2025-01-01T00:00:00.000Z');
      const activity = recorded('activity', null);
      registry.register(refusals.def);
      registry.register(activity.def);

      await registry.onApplicationBootstrap();

      expect(since('refusals')).toBe('2026-03-01T00:00:00.000Z');
      expect(since('activity')).toBe('2026-06-01T00:00:00.000Z');
      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(gateway.remove).not.toHaveBeenCalled();
      // The first record is asked once in a recorded figure's life, not at
      // every boot.
      expect(refusals.firstRecord).not.toHaveBeenCalled();
      expect(activity.firstRecord).not.toHaveBeenCalled();
    });

    it('is written only where the row is missing when some figures are new', async () => {
      const { registry, gateway, since } = makeRegistry({
        activity: '2026-03-01T00:00:00.000Z',
      });
      registry.register(recorded('activity', '2025-01-01T00:00:00.000Z').def);
      registry.register(recorded('refusals', '2026-10-30T00:00:00.000Z').def);

      await registry.onApplicationBootstrap();

      expect(gateway.createIfAbsent).toHaveBeenCalledTimes(1);
      expect(since('activity')).toBe('2026-03-01T00:00:00.000Z');
      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
    });

    it('keeps the date of its first boot at every later one', async () => {
      const { registry, gateway, rows, since } = makeRegistry();
      const activity = recorded('activity', null);
      registry.register(activity.def);
      await registry.onApplicationBootstrap();

      jest.setSystemTime(NEXT_BOOT);
      // Rows have arrived since, and they change nothing: what the figure
      // did not record before its first boot is still missing.
      activity.firstRecord.mockResolvedValue(at('2026-11-30T00:00:00.000Z'));
      await registry.onApplicationBootstrap();

      expect(rows.size).toBe(1);
      expect(since('activity')).toBe(BOOT.toISOString());
      expect(activity.firstRecord).toHaveBeenCalledTimes(1);
      expect(gateway.remove).not.toHaveBeenCalled();
    });

    it('has no row when its first record cannot be read, and the next figure is still written', async () => {
      const { registry, since } = makeRegistry();
      const broken = recorded('activity', null);
      broken.firstRecord.mockRejectedValue(new Error('relation missing'));
      registry.register(broken.def);
      registry.register(recorded('refusals', '2026-10-30T00:00:00.000Z').def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      // No row rather than a row saying "complete from now": that date could
      // never be moved back once the source is readable again.
      expect(since('activity')).toBeUndefined();
      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
      expect(captureBackgroundError).toHaveBeenCalledWith(
        expect.any(Error),
        'stats.figures',
      );
    });

    it('lets the API boot when its row cannot be written, and goes on to the next', async () => {
      const { registry, gateway, since } = makeRegistry();
      gateway.createIfAbsent.mockRejectedValueOnce(
        new Error('connection lost'),
      );
      registry.register(recorded('activity', null).def);
      registry.register(recorded('refusals', '2026-10-30T00:00:00.000Z').def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(since('activity')).toBeUndefined();
      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
    });
  });

  // CLEAN-262. A figure read in place has nothing but its rows: none before
  // some day means nothing happened before it, not that something was
  // missed. So it has no row saying since when it is complete, and no note.
  describe('at boot, a figure read in place', () => {
    it('never gets a row', async () => {
      const { registry, gateway, rows } = makeRegistry();
      registry.register(readInPlace('ratings'));
      registry.register(readInPlace('spend'));

      await registry.onApplicationBootstrap();
      jest.setSystemTime(NEXT_BOOT);
      await registry.onApplicationBootstrap();

      expect(rows.size).toBe(0);
      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(gateway.remove).not.toHaveBeenCalled();
    });

    it.each([
      // What the release before the fix wrote for an empty source: "now".
      ['the time of an earlier boot', BOOT.toISOString()],
      // What it wrote for a source that had rows: the earliest of them.
      ['the time of its earliest row', '2026-07-15T09:12:00.000Z'],
      ['a time long past', '2020-01-01T00:00:00.000Z'],
      ['a time still to come', '2027-03-01T00:00:00.000Z'],
    ])('loses a row that holds %s', async (_what, held) => {
      const { registry, gateway, rows } = makeRegistry({ ratings: held });
      registry.register(readInPlace('ratings'));
      jest.setSystemTime(NEXT_BOOT);

      await registry.onApplicationBootstrap();

      expect(rows.has('ratings')).toBe(false);
      expect(gateway.remove).toHaveBeenCalledTimes(1);
      expect(gateway.remove).toHaveBeenCalledWith('ratings');
      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(captureBackgroundError).not.toHaveBeenCalled();
    });

    it('is removed once: the next boot finds no row and does nothing', async () => {
      const { registry, gateway, rows } = makeRegistry({
        ratings: BOOT.toISOString(),
      });
      registry.register(readInPlace('ratings'));

      await registry.onApplicationBootstrap();
      jest.setSystemTime(NEXT_BOOT);
      await registry.onApplicationBootstrap();

      expect(rows.size).toBe(0);
      expect(gateway.remove).toHaveBeenCalledTimes(1);
    });

    it('is never asked for its first record, with a row or without one', async () => {
      // A definition that still carries one, as all four did before the fix.
      const firstRecord = jest.fn(() =>
        Promise.resolve(at('2026-07-15T09:12:00.000Z')),
      );
      const { registry, rows } = makeRegistry({
        ratings: BOOT.toISOString(),
      });
      registry.register({ ...readInPlace('ratings'), firstRecord });
      registry.register({ ...readInPlace('citations'), firstRecord });

      await registry.onApplicationBootstrap();

      expect(firstRecord).not.toHaveBeenCalled();
      // And its answer is not written: there is still no row.
      expect(rows.size).toBe(0);
    });

    it('is reported once when its row cannot be removed, and the rest goes on', async () => {
      const { registry, gateway, rows, since } = makeRegistry({
        ratings: BOOT.toISOString(),
        citations: '2026-09-01T14:00:00.000Z',
      });
      gateway.remove.mockRejectedValueOnce(new Error('connection lost'));
      registry.register(readInPlace('ratings'));
      registry.register(readInPlace('citations'));
      registry.register(recorded('activity', null).def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(since('ratings')).toBe(BOOT.toISOString());
      expect(rows.has('citations')).toBe(false);
      expect(since('activity')).toBe(BOOT.toISOString());
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
      expect(captureBackgroundError).toHaveBeenCalledWith(
        expect.any(Error),
        'stats.figures',
      );

      // The row that stayed is removed at the next boot.
      await registry.onApplicationBootstrap();
      expect(rows.has('ratings')).toBe(false);
      expect(since('activity')).toBe(BOOT.toISOString());
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
    });
  });

  describe('at boot', () => {
    it('boots with no figures and writes nothing', async () => {
      const { registry, gateway, rows } = makeRegistry();

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(rows.size).toBe(0);
    });

    it('lets the API boot when the table cannot be read', async () => {
      const { registry, gateway } = makeRegistry();
      gateway.findAll.mockRejectedValue(new Error('connection refused'));
      const activity = recorded('activity', null);
      registry.register(readInPlace('spend'));
      registry.register(activity.def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(gateway.remove).not.toHaveBeenCalled();
      expect(activity.firstRecord).not.toHaveBeenCalled();
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
    });

    it('leaves alone a row whose figure is not registered', async () => {
      // A figure taken out of the code, or one a newer release knows.
      const { registry, gateway, since } = makeRegistry({
        summaries: '2026-05-01T00:00:00.000Z',
      });
      registry.register(readInPlace('ratings'));
      registry.register(recorded('activity', null).def);

      await registry.onApplicationBootstrap();

      expect(since('summaries')).toBe('2026-05-01T00:00:00.000Z');
      expect(gateway.remove).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('refuses a second figure with the same key', () => {
      const { registry } = makeRegistry();
      registry.register(readInPlace('spend'));

      expect(() => registry.register(readInPlace('spend'))).toThrow(/spend/);
    });

    it('lists what was registered, in that order', () => {
      const { registry } = makeRegistry();
      registry.register(readInPlace('spend'));
      registry.register(recorded('activity', null).def);

      expect(registry.list().map((f) => f.key)).toEqual(['spend', 'activity']);
    });
  });

  describe('notesFor', () => {
    const SEED = {
      // Recording began in the middle of the period asked for below.
      activity: '2026-11-20T09:00:00.000Z',
      // Complete long before it.
      summaries: '2026-01-01T00:00:00.000Z',
      // Complete from exactly the start of the period.
      refusals: '2026-11-01T00:00:00.000Z',
    };
    const FROM = at('2026-11-01T00:00:00.000Z');

    function seeded() {
      const made = makeRegistry(SEED);
      for (const key of Object.keys(SEED)) {
        made.registry.register(recorded(key, null).def);
      }
      return made;
    }

    it('returns a note only for a figure complete later than the period starts', async () => {
      const { registry } = seeded();

      const notes = await registry.notesFor(
        ['activity', 'summaries', 'refusals'],
        FROM,
      );

      expect(notes).toEqual([
        { figure: 'activity', completeSince: at('2026-11-20T09:00:00.000Z') },
      ]);
    });

    it('answers only for the figures asked about, in the order asked', async () => {
      const { registry } = seeded();
      const early = at('2025-06-01T00:00:00.000Z');

      expect(
        (await registry.notesFor(['summaries', 'activity'], early)).map(
          (n) => n.figure,
        ),
      ).toEqual(['summaries', 'activity']);
      expect(await registry.notesFor(['summaries'], FROM)).toEqual([]);
      expect(await registry.notesFor([], early)).toEqual([]);
    });

    it('names a figure once however often it is asked about', async () => {
      const { registry } = seeded();

      const notes = await registry.notesFor(['activity', 'activity'], FROM);

      expect(notes).toHaveLength(1);
    });

    it('reads the rows written at boot', async () => {
      const { registry } = makeRegistry();
      registry.register(recorded('activity', null).def);
      await registry.onApplicationBootstrap();

      expect(await registry.notesFor(['activity'], FROM)).toEqual([
        { figure: 'activity', completeSince: BOOT },
      ]);
      expect(await registry.notesFor(['activity'], BOOT)).toEqual([]);
    });

    it('has no note for a recorded figure that has no row yet', async () => {
      const { registry } = makeRegistry();
      registry.register(recorded('activity', null).def);

      expect(await registry.notesFor(['activity'], FROM)).toEqual([]);
    });

    // CLEAN-262. Nobody rated before the first rating: there is no stretch
    // the figure fails to cover, however far back the period goes.
    it('returns nothing for a figure read in place, however early the period starts', async () => {
      const { registry } = makeRegistry();
      registry.register(readInPlace('ratings'));
      await registry.onApplicationBootstrap();

      expect(
        await registry.notesFor(['ratings'], at('2020-01-01T00:00:00.000Z')),
      ).toEqual([]);
    });

    it('returns nothing for a figure read in place whose stale row is still there', async () => {
      // Boot has not run yet, or could not remove the row.
      const { registry } = makeRegistry({
        ratings: '2026-11-20T09:00:00.000Z',
        activity: '2026-11-20T09:00:00.000Z',
      });
      registry.register(readInPlace('ratings'));
      registry.register(recorded('activity', null).def);

      expect(await registry.notesFor(['ratings'], FROM)).toEqual([]);
      // The recorded figure beside it is answered for as before.
      expect(await registry.notesFor(['ratings', 'activity'], FROM)).toEqual([
        { figure: 'activity', completeSince: at('2026-11-20T09:00:00.000Z') },
      ]);
    });

    it('refuses a key that was never registered', async () => {
      const { registry } = seeded();

      await expect(registry.notesFor(['mesages'], FROM)).rejects.toThrow(
        /mesages/,
      );
    });

    it('refuses it also when every other key asked about is read in place', async () => {
      const { registry } = makeRegistry();
      registry.register(readInPlace('ratings'));

      await expect(
        registry.notesFor(['ratings', 'mesages'], FROM),
      ).rejects.toThrow(/mesages/);
    });
  });
});
