import { AgentLimitService } from '#/agent/limit/domain';
import { IDelegationGateway } from '#/agent/peer/domain/delegation.gateway';
import { IChatGateway } from '#/chat/domain/chat.gateway';
import { ChatSourceService } from '#/chat/domain/chatSource.service';
import { IUsageGateway } from '#/usage/domain';
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

  // The three figures of "How agents helped" (CLEAN-258). Each is read in
  // place: its rows are the record, so there is no rebuild to name, and it
  // is complete from the first of them.
  it('ratings go back to the first rating anybody gave', async () => {
    const first = new Date('2026-07-15T09:12:00.000Z');
    const figure = ratingsFigure(
      only<IChatGateway>({ firstFeedbackAt: () => Promise.resolve(first) }),
    );
    expect(figure.key).toBe('ratings');
    expect(figure.scopes).toEqual(['personal']);
    expect(figure.rebuild).toBeUndefined();
    expect(await figure.firstRecord()).toBe(first);
  });

  it('citations go back to the first source an answer cited', async () => {
    const first = new Date('2026-09-01T14:00:00.000Z');
    const figure = citationsFigure(
      only<ChatSourceService>({ firstRecordAt: () => Promise.resolve(first) }),
    );
    expect(figure.key).toBe('citations');
    expect(figure.scopes).toEqual(['personal']);
    expect(figure.rebuild).toBeUndefined();
    expect(await figure.firstRecord()).toBe(first);
  });

  it('hand-overs go back to the first one on record', async () => {
    const first = new Date('2026-09-14T10:00:00.000Z');
    const figure = handoversFigure(
      only<IDelegationGateway>({ firstRecordAt: () => Promise.resolve(first) }),
    );
    expect(figure.key).toBe('handovers');
    expect(figure.scopes).toEqual(['personal']);
    expect(figure.rebuild).toBeUndefined();
    expect(await figure.firstRecord()).toBe(first);
  });

  it('a figure with no row yet is complete from now: its first record is null', async () => {
    const none = () => Promise.resolve(null);
    expect(
      await ratingsFigure(
        only<IChatGateway>({ firstFeedbackAt: none }),
      ).firstRecord(),
    ).toBeNull();
    expect(
      await citationsFigure(
        only<ChatSourceService>({ firstRecordAt: none }),
      ).firstRecord(),
    ).toBeNull();
    expect(
      await handoversFigure(
        only<IDelegationGateway>({ firstRecordAt: none }),
      ).firstRecord(),
    ).toBeNull();
  });

  it('registers each figure once, under its own key', () => {
    const registered: IFigureDefinition[] = [];
    const none = () => Promise.resolve(null);
    const figures = new StatFigures(
      only<FigureRegistry>({
        register: (definition: IFigureDefinition) => {
          registered.push(definition);
        },
      }),
      only<AgentLimitService>({ firstLoadDayAt: none }),
      only<IUsageGateway>({ firstRecordAt: none }),
      only<IChatGateway>({ firstFeedbackAt: none }),
      only<ChatSourceService>({ firstRecordAt: none }),
      only<IDelegationGateway>({ firstRecordAt: none }),
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
});
