import { AgentLimitService } from '#/agent/limit/domain';
import { FigureRegistry } from '../figureRegistry';
import { IFigureDefinition } from '../figure.types';
import {
  StatFigures,
  activityFigure,
  citationsFigure,
  handoversFigure,
  ratingsFigure,
  refusalsFigure,
  spendFigure,
} from '.';

const only = <T>(members: Record<string, unknown>): T =>
  members as unknown as T;

describe('figure definitions', () => {
  it('activity is complete from the boot that starts recording it', async () => {
    expect(activityFigure.key).toBe('activity');
    expect(activityFigure.scopes).toEqual(['personal', 'installation']);
    expect(activityFigure.rebuild).toBe('chat.settle');
    // Null is what the registry turns into "from now".
    expect(await activityFigure.firstRecord?.()).toBeNull();
  });

  it('refusals go back to the earliest day row of the limit slice', async () => {
    const first = new Date('2026-10-28T00:00:00.000Z');
    const figure = refusalsFigure(
      only<AgentLimitService>({
        firstLoadDayAt: () => Promise.resolve(first),
      }),
    );
    expect(figure.key).toBe('refusals');
    expect(figure.scopes).toEqual(['installation']);
    expect(figure.rebuild).toBe('agentLimit.rebuildMissingDays');
    expect(await figure.firstRecord?.()).toBe(first);
  });

  // The figures read in place (CLEAN-262): spend, and the three of "How
  // agents helped" (CLEAN-258). Their rows are the record, so there is no
  // rebuild to name, which is what tells the registry to keep no row for
  // them, and no first record to ask for: nothing came before the first row.
  it.each([
    ['spend', spendFigure, ['installation']],
    ['ratings', ratingsFigure, ['personal']],
    ['citations', citationsFigure, ['personal']],
    ['handovers', handoversFigure, ['personal']],
  ] as const)(
    '%s is read in place: no rebuild and no first record',
    (key, figure, scopes) => {
      expect(figure.key).toBe(key);
      expect(figure.scopes).toEqual(scopes);
      expect(figure.rebuild).toBeUndefined();
      expect('firstRecord' in figure).toBe(false);
    },
  );

  it('registers each figure once, under its own key', () => {
    const registered: IFigureDefinition[] = [];
    const figures = new StatFigures(
      only<FigureRegistry>({
        register: (definition: IFigureDefinition) => {
          registered.push(definition);
        },
      }),
      only<AgentLimitService>({ firstLoadDayAt: () => Promise.resolve(null) }),
    );
    figures.onModuleInit();
    const keys = registered.map((definition) => definition.key);
    expect(keys).toEqual([
      'activity',
      'refusals',
      'spend',
      'ratings',
      'citations',
      'handovers',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('registers two recorded figures, and the rest read in place', () => {
    const registered: IFigureDefinition[] = [];
    new StatFigures(
      only<FigureRegistry>({
        register: (definition: IFigureDefinition) => {
          registered.push(definition);
        },
      }),
      only<AgentLimitService>({ firstLoadDayAt: () => Promise.resolve(null) }),
    ).onModuleInit();

    expect(
      registered.filter((d) => d.rebuild !== undefined).map((d) => d.key),
    ).toEqual(['activity', 'refusals']);
    // None read in place carries a first record: there is nothing to ask.
    expect(
      registered
        .filter((d) => d.rebuild === undefined)
        .every((d) => !('firstRecord' in d)),
    ).toBe(true);
  });
});
