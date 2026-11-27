import {
  IAgentDayCalls,
  IAgentDayMessages,
  UNKNOWN_MODEL,
  attributeModels,
} from './modelAttribution';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-8';

const wrote = (
  agentId: string,
  day: string,
  messages: number,
): IAgentDayMessages => ({ agentId, day, messages });

const called = (
  agentId: string,
  day: string,
  model: string,
  calls: number,
): IAgentDayCalls => ({ agentId, day, model, calls });

/** Every agent in these cases runs Haiku today, unless the case says so. */
const onHaiku = () => HAIKU;

const total = (items: { messages: number }[]) =>
  items.reduce((sum, item) => sum + item.messages, 0);

describe('attributeModels', () => {
  it('gives a day’s messages to the one model the agent used that day', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 6)],
      [called('a1', '2026-11-25', SONNET, 40)],
      onHaiku,
    );

    expect(result).toEqual({
      items: [{ model: SONNET, messages: 6 }],
      fallback: false,
    });
  });

  it('follows a change of model: the days before it to the earlier one, the days after to the later', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-24', 5), wrote('a1', '2026-11-26', 2)],
      [
        called('a1', '2026-11-24', SONNET, 12),
        called('a1', '2026-11-26', HAIKU, 9),
      ],
      onHaiku,
    );

    expect(result.items).toEqual([
      { model: SONNET, messages: 5 },
      { model: HAIKU, messages: 2 },
    ]);
    expect(result.fallback).toBe(false);
  });

  it('splits a day between two models by their calls, in whole messages that add up', () => {
    // 10 messages, calls 2 to 1: 6.67 and 3.33. The whole parts are 6 and 3;
    // the message left over goes to the larger remainder, 0.67.
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 10)],
      [
        called('a1', '2026-11-25', SONNET, 20),
        called('a1', '2026-11-25', HAIKU, 10),
      ],
      onHaiku,
    );

    expect(result.items).toEqual([
      { model: SONNET, messages: 7 },
      { model: HAIKU, messages: 3 },
    ]);
    expect(total(result.items)).toBe(10);
  });

  it('breaks an exact tie the same way every time: the model called more, then by name', () => {
    // 10 messages over three models called equally: 3.33 each, one left
    // over, three equal remainders and equal calls. The name decides.
    const equal = attributeModels(
      [wrote('a1', '2026-11-25', 10)],
      [
        called('a1', '2026-11-25', SONNET, 5),
        called('a1', '2026-11-25', OPUS, 5),
        called('a1', '2026-11-25', HAIKU, 5),
      ],
      onHaiku,
    );
    expect(equal.items).toEqual([
      { model: HAIKU, messages: 4 },
      { model: OPUS, messages: 3 },
      { model: SONNET, messages: 3 },
    ]);

    // 1 message, calls 1 to 1: half each, and it cannot be halved.
    const one = attributeModels(
      [wrote('a1', '2026-11-25', 1)],
      [
        called('a1', '2026-11-25', SONNET, 3),
        called('a1', '2026-11-25', HAIKU, 3),
      ],
      onHaiku,
    );
    expect(one.items).toEqual([{ model: HAIKU, messages: 1 }]);
  });

  it('adds the same model up across days and agents', () => {
    const result = attributeModels(
      [
        wrote('a1', '2026-11-24', 3),
        wrote('a1', '2026-11-25', 4),
        wrote('a2', '2026-11-25', 2),
      ],
      [
        called('a1', '2026-11-24', SONNET, 7),
        called('a1', '2026-11-25', SONNET, 7),
        called('a2', '2026-11-25', SONNET, 1),
      ],
      onHaiku,
    );

    expect(result.items).toEqual([{ model: SONNET, messages: 9 }]);
  });

  it('gives a day with no usage row to the agent’s current model, and says it had to', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 4), wrote('a1', '2026-11-27', 3)],
      // The 27th is today: the agent reports its day at the end of it.
      [called('a1', '2026-11-25', SONNET, 10)],
      onHaiku,
    );

    expect(result).toEqual({
      items: [
        { model: SONNET, messages: 4 },
        { model: HAIKU, messages: 3 },
      ],
      fallback: true,
    });
  });

  it('gives today to the current model without raising the flag, when told which day is today', () => {
    const args = [
      [wrote('a1', '2026-11-25', 4), wrote('a1', '2026-11-27', 3)],
      // No row for the 27th: a runtime reports its day at 23:50 UTC.
      [called('a1', '2026-11-25', SONNET, 10)],
      onHaiku,
    ] as const;
    const items = [
      { model: SONNET, messages: 4 },
      { model: HAIKU, messages: 3 },
    ];

    // Today: the model the agent has now is the model it has today.
    expect(attributeModels(...args, '2026-11-27')).toEqual({
      items,
      fallback: false,
    });
    // The same gap on a past day is still a guess, and says so.
    expect(attributeModels(...args, '2026-11-28')).toEqual({
      items,
      fallback: true,
    });
  });

  it('does not read another agent’s day, or the same agent’s other day, as a record', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 4)],
      [
        called('a2', '2026-11-25', SONNET, 10),
        called('a1', '2026-11-24', SONNET, 10),
      ],
      onHaiku,
    );

    expect(result).toEqual({
      items: [{ model: HAIKU, messages: 4 }],
      fallback: true,
    });
  });

  it('reads a row that reports no calls as no record', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 4)],
      [called('a1', '2026-11-25', SONNET, 0)],
      onHaiku,
    );

    expect(result).toEqual({
      items: [{ model: HAIKU, messages: 4 }],
      fallback: true,
    });
  });

  it('files an agent with neither a record nor a current model under `unknown`', () => {
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 4), wrote('a2', '2026-11-25', 1)],
      [called('a2', '2026-11-25', SONNET, 2)],
      () => null,
    );

    expect(UNKNOWN_MODEL).toBe('unknown');
    expect(result).toEqual({
      items: [
        { model: 'unknown', messages: 4 },
        { model: SONNET, messages: 1 },
      ],
      fallback: true,
    });
  });

  it('orders the models by messages, most first, and equal ones by name', () => {
    const result = attributeModels(
      [
        wrote('a1', '2026-11-25', 2),
        wrote('a2', '2026-11-25', 9),
        wrote('a3', '2026-11-25', 2),
      ],
      [
        called('a1', '2026-11-25', SONNET, 1),
        called('a2', '2026-11-25', OPUS, 1),
        called('a3', '2026-11-25', HAIKU, 1),
      ],
      onHaiku,
    );

    expect(result.items).toEqual([
      { model: OPUS, messages: 9 },
      { model: HAIKU, messages: 2 },
      { model: SONNET, messages: 2 },
    ]);
  });

  it('leaves out a model that ends with no whole message', () => {
    // 1 message, calls 9 to 1: the one message goes to the model called 9
    // times, and the other is not listed with a zero.
    const result = attributeModels(
      [wrote('a1', '2026-11-25', 1)],
      [
        called('a1', '2026-11-25', SONNET, 9),
        called('a1', '2026-11-25', HAIKU, 1),
      ],
      onHaiku,
    );

    expect(result.items).toEqual([{ model: SONNET, messages: 1 }]);
  });

  it('ignores a day on which the person wrote nothing', () => {
    const result = attributeModels([wrote('a1', '2026-11-25', 0)], [], onHaiku);

    expect(result).toEqual({ items: [], fallback: false });
  });

  it('answers nothing, and no fallback, for no messages at all', () => {
    expect(attributeModels([], [], onHaiku)).toEqual({
      items: [],
      fallback: false,
    });
  });

  it('never loses or invents a message, whatever the mix', () => {
    const messages = [
      wrote('a1', '2026-11-21', 17),
      wrote('a1', '2026-11-22', 1),
      wrote('a2', '2026-11-22', 23),
      wrote('a3', '2026-11-23', 5),
    ];
    const result = attributeModels(
      messages,
      [
        called('a1', '2026-11-21', SONNET, 7),
        called('a1', '2026-11-21', HAIKU, 3),
        called('a1', '2026-11-21', OPUS, 1),
        called('a2', '2026-11-22', SONNET, 13),
        called('a2', '2026-11-22', OPUS, 29),
      ],
      (agentId) => (agentId === 'a3' ? null : HAIKU),
    );

    expect(total(result.items)).toBe(total(messages));
    expect(result.fallback).toBe(true);
  });
});
