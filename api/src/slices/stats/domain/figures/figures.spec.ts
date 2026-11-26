import { AgentLimitService } from '#/agent/limit/domain';
import { IUsageGateway } from '#/usage/domain';
import { FigureRegistry } from '../figureRegistry';
import { IFigureDefinition } from '../figure.types';
import { StatFigures, activityFigure, refusalsFigure, spendFigure } from '.';

const only = <T>(members: Record<string, unknown>): T =>
  members as unknown as T;

describe('figure definitions', () => {
  it('activity is complete from the boot that starts recording it', async () => {
    expect(activityFigure.key).toBe('activity');
    expect(activityFigure.scopes).toEqual(['personal', 'installation']);
    expect(activityFigure.rebuild).toBe('chat.settle');
    // Null is what the registry turns into "from now".
    expect(await activityFigure.firstRecord()).toBeNull();
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
    expect(await figure.firstRecord()).toBe(first);
  });

  it('spend goes back to the first reported day and has no rebuild', async () => {
    const first = new Date('2026-04-22T00:00:00.000Z');
    const figure = spendFigure(
      only<IUsageGateway>({ firstRecordAt: () => Promise.resolve(first) }),
    );
    expect(figure.key).toBe('spend');
    expect(figure.rebuild).toBeUndefined();
    expect(await figure.firstRecord()).toBe(first);
  });

  it('registers each figure once, under its own key', () => {
    const registered: IFigureDefinition[] = [];
    const figures = new StatFigures(
      only<FigureRegistry>({
        register: (definition: IFigureDefinition) => {
          registered.push(definition);
        },
      }),
      only<AgentLimitService>({ firstLoadDayAt: () => Promise.resolve(null) }),
      only<IUsageGateway>({ firstRecordAt: () => Promise.resolve(null) }),
    );
    figures.onModuleInit();
    const keys = registered.map((definition) => definition.key);
    expect(keys).toEqual(['activity', 'refusals', 'spend']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
