import { captureBackgroundError } from '#/setup/sentry';
import { IFigureDefinition, IStatFigureData } from './figure.types';
import { FigureRegistry } from './figureRegistry';
import { IStatFigureGateway } from './statFigure.gateway';

jest.mock('#/setup/sentry', () => ({ captureBackgroundError: jest.fn() }));

const at = (iso: string) => new Date(iso);

const BOOT = at('2026-11-27T10:00:00.000Z');

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
  };
  const since = (key: string) => rows.get(key)?.completeSince.toISOString();
  return { gateway, rows, since };
}

function figure(
  key: string,
  first: string | null,
  extra: Partial<IFigureDefinition> = {},
) {
  const firstRecord = jest.fn(() => Promise.resolve(first ? at(first) : null));
  const def: IFigureDefinition = {
    key,
    scopes: ['personal'],
    firstRecord,
    ...extra,
  };
  return { def, firstRecord };
}

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

  describe('at boot', () => {
    it('writes a row for a figure that has none, from its first record', async () => {
      const { registry, since } = makeRegistry();
      registry.register(figure('spend', '2026-03-01T00:00:00.000Z').def);

      await registry.onApplicationBootstrap();

      expect(since('spend')).toBe('2026-03-01T00:00:00.000Z');
    });

    it('takes now for a figure whose source has no record yet', async () => {
      const { registry, since } = makeRegistry();
      registry.register(
        figure('activity', null, { rebuild: 'chat.settle' }).def,
      );

      await registry.onApplicationBootstrap();

      expect(since('activity')).toBe(BOOT.toISOString());
    });

    it('leaves a figure that has a row alone, whatever its first record now is', async () => {
      const { registry, gateway, since } = makeRegistry({
        spend: '2026-03-01T00:00:00.000Z',
        activity: '2026-06-01T00:00:00.000Z',
      });
      // An older record turned up, and a source that has since been emptied.
      const spend = figure('spend', '2025-01-01T00:00:00.000Z');
      const activity = figure('activity', null);
      registry.register(spend.def);
      registry.register(activity.def);

      await registry.onApplicationBootstrap();

      expect(since('spend')).toBe('2026-03-01T00:00:00.000Z');
      expect(since('activity')).toBe('2026-06-01T00:00:00.000Z');
      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      // The first record is asked once in a figure's life, not at every boot.
      expect(spend.firstRecord).not.toHaveBeenCalled();
      expect(activity.firstRecord).not.toHaveBeenCalled();
    });

    it('writes only the missing rows when some figures are new', async () => {
      const { registry, gateway, since } = makeRegistry({
        spend: '2026-03-01T00:00:00.000Z',
      });
      registry.register(figure('spend', '2025-01-01T00:00:00.000Z').def);
      registry.register(figure('refusals', '2026-10-30T00:00:00.000Z').def);

      await registry.onApplicationBootstrap();

      expect(gateway.createIfAbsent).toHaveBeenCalledTimes(1);
      expect(since('spend')).toBe('2026-03-01T00:00:00.000Z');
      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
    });

    it('changes nothing on a second boot', async () => {
      const { registry, rows, since } = makeRegistry();
      registry.register(figure('activity', null).def);
      await registry.onApplicationBootstrap();

      jest.setSystemTime(at('2026-12-05T10:00:00.000Z'));
      await registry.onApplicationBootstrap();

      expect(rows.size).toBe(1);
      expect(since('activity')).toBe(BOOT.toISOString());
    });

    it('boots with no figures and writes nothing', async () => {
      const { registry, gateway, rows } = makeRegistry();

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(rows.size).toBe(0);
    });

    it('gives a figure whose first record cannot be read no row, and goes on to the next', async () => {
      const { registry, since } = makeRegistry();
      const broken = figure('spend', null);
      broken.firstRecord.mockRejectedValue(new Error('relation missing'));
      registry.register(broken.def);
      registry.register(figure('refusals', '2026-10-30T00:00:00.000Z').def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      // No row rather than a row saying "complete from now": that date could
      // never be moved back once the source is readable again.
      expect(since('spend')).toBeUndefined();
      expect(since('refusals')).toBe('2026-10-30T00:00:00.000Z');
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
      expect(captureBackgroundError).toHaveBeenCalledWith(
        expect.any(Error),
        'stats.figures',
      );
    });

    it('lets the API boot when the table cannot be read', async () => {
      const { registry, gateway } = makeRegistry();
      gateway.findAll.mockRejectedValue(new Error('connection refused'));
      registry.register(figure('spend', null).def);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(gateway.createIfAbsent).not.toHaveBeenCalled();
      expect(captureBackgroundError).toHaveBeenCalledTimes(1);
    });
  });

  describe('register', () => {
    it('refuses a second figure with the same key', () => {
      const { registry } = makeRegistry();
      registry.register(figure('spend', null).def);

      expect(() => registry.register(figure('spend', null).def)).toThrow(
        /spend/,
      );
    });

    it('lists what was registered, in that order', () => {
      const { registry } = makeRegistry();
      registry.register(figure('spend', null).def);
      registry.register(figure('activity', null).def);

      expect(registry.list().map((f) => f.key)).toEqual(['spend', 'activity']);
    });
  });

  describe('notesFor', () => {
    const SEED = {
      // Recording began in the middle of the period asked for below.
      activity: '2026-11-20T09:00:00.000Z',
      // Complete long before it.
      spend: '2026-01-01T00:00:00.000Z',
      // Complete from exactly the start of the period.
      refusals: '2026-11-01T00:00:00.000Z',
    };
    const FROM = at('2026-11-01T00:00:00.000Z');

    function seeded() {
      const made = makeRegistry(SEED);
      for (const key of Object.keys(SEED)) {
        made.registry.register(figure(key, null).def);
      }
      return made;
    }

    it('returns a note only for a figure complete later than the period starts', async () => {
      const { registry } = seeded();

      const notes = await registry.notesFor(
        ['activity', 'spend', 'refusals'],
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
        (await registry.notesFor(['spend', 'activity'], early)).map(
          (n) => n.figure,
        ),
      ).toEqual(['spend', 'activity']);
      expect(await registry.notesFor(['spend'], FROM)).toEqual([]);
      expect(await registry.notesFor([], early)).toEqual([]);
    });

    it('names a figure once however often it is asked about', async () => {
      const { registry } = seeded();

      const notes = await registry.notesFor(['activity', 'activity'], FROM);

      expect(notes).toHaveLength(1);
    });

    it('reads the rows written at boot', async () => {
      const { registry } = makeRegistry();
      registry.register(figure('activity', null).def);
      await registry.onApplicationBootstrap();

      expect(await registry.notesFor(['activity'], FROM)).toEqual([
        { figure: 'activity', completeSince: BOOT },
      ]);
      expect(await registry.notesFor(['activity'], BOOT)).toEqual([]);
    });

    it('has no note for a registered figure that has no row yet', async () => {
      const { registry } = makeRegistry();
      registry.register(figure('activity', null).def);

      expect(await registry.notesFor(['activity'], FROM)).toEqual([]);
    });

    it('refuses a key that was never registered', async () => {
      const { registry } = seeded();

      await expect(registry.notesFor(['mesages'], FROM)).rejects.toThrow(
        /mesages/,
      );
    });
  });
});
