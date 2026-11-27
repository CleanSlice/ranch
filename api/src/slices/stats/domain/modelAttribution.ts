// Which model answered a person (CLEAN-258; spec 038, FR-013 and research
// R8).
//
// Nothing records the model of a single answer. What is kept is `Usage`: one
// row per agent, model and UTC day, with the number of calls. So a person's
// messages to an agent on a day are given to the models that agent used that
// day, in proportion to their calls. It is exact whenever an agent used one
// model on a day, which is nearly always, and it follows a change of model
// from the day it was made.
//
// A day with no usage row has nothing to go by. Its messages go to the model
// the agent has now, and the answer says so (`fallback`), so the card can
// state it in one line instead of presenting a guess as a record. Today is
// always such a day, since a runtime posts its usage at 23:50 UTC or when it
// shuts down (see `UsageController.findForAgent`), not as it goes; when the
// caller says which day is today, that day goes to the current model without
// the flag.
//
// Pure: no Nest, no database, no clock. Days are calendar dates in UTC,
// `YYYY-MM-DD`, the boundary `Usage.date` is kept on.

/** The model an answer is filed under when nothing says which it was. */
export const UNKNOWN_MODEL = 'unknown';

/** The person's own messages to one agent on one UTC day. */
export interface IAgentDayMessages {
  agentId: string;
  day: string;
  messages: number;
}

/** How often one agent called one model on one UTC day. */
export interface IAgentDayCalls {
  agentId: string;
  day: string;
  model: string;
  calls: number;
}

export interface IModelShare {
  model: string;
  /** Whole messages: the parts of a day add up to what was written. */
  messages: number;
}

export interface IModelAttribution {
  /** By messages, most first; equal ones by name. No model with zero. */
  items: IModelShare[];
  /** True when at least one day had no usage record to go by. */
  fallback: boolean;
}

const dayOf = (agentId: string, day: string) => `${agentId}|${day}`;

/**
 * Split `messages` between models in proportion to their calls, in whole
 * messages that add up to `messages` (the largest remainder method): each
 * model gets the whole part of its share, and the messages left over go one
 * each to the largest remainders. A plain rounding of each share can lose a
 * message or invent one (three equal models and ten messages round to nine).
 *
 * Equal remainders are settled by the model called more often, then by
 * name, so one day gives one answer however its rows were ordered.
 */
function splitByCalls(
  messages: number,
  calls: ReadonlyMap<string, number>,
): Map<string, number> {
  let totalCalls = 0;
  for (const n of calls.values()) totalCalls += n;

  const parts = [...calls].map(([model, n]) => {
    // Integers throughout: `messages * n` is far inside what a double holds
    // exactly, and its remainder by the total is the share's fraction
    // without a rounding error to break a tie by.
    const scaled = messages * n;
    return {
      model,
      calls: n,
      whole: Math.floor(scaled / totalCalls),
      remainder: scaled % totalCalls,
    };
  });

  let left = messages;
  for (const part of parts) left -= part.whole;

  parts.sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.calls - a.calls ||
      a.model.localeCompare(b.model),
  );
  // The whole parts fall short of the total by less than one per model, so
  // one pass over the list hands out everything that is left.
  for (const part of parts) {
    if (left <= 0) break;
    part.whole += 1;
    left -= 1;
  }

  return new Map(parts.map((part) => [part.model, part.whole]));
}

/**
 * The person's messages by the model that answered them.
 *
 * `currentModel` answers which model an agent has now, or nothing when it
 * has none (no credential, or one that is gone). It is asked only for a day
 * without a usage record.
 */
export function attributeModels(
  messages: readonly IAgentDayMessages[],
  usage: readonly IAgentDayCalls[],
  currentModel: (agentId: string) => string | null | undefined,
  today?: string,
): IModelAttribution {
  // Calls per model for each agent and day. A row that reports no calls
  // says the model did nothing that day, which is no record of who answered.
  const callsByDay = new Map<string, Map<string, number>>();
  for (const row of usage) {
    if (!(row.calls > 0)) continue;
    const key = dayOf(row.agentId, row.day);
    const models = callsByDay.get(key) ?? new Map<string, number>();
    models.set(row.model, (models.get(row.model) ?? 0) + row.calls);
    callsByDay.set(key, models);
  }

  const totals = new Map<string, number>();
  const add = (model: string, n: number) => {
    if (n > 0) totals.set(model, (totals.get(model) ?? 0) + n);
  };

  let fallback = false;
  for (const row of messages) {
    if (!(row.messages > 0)) continue;
    const calls = callsByDay.get(dayOf(row.agentId, row.day));
    if (!calls) {
      // Today has no usage row yet for anyone: a runtime reports its day at
      // 23:50 UTC. The model an agent has now is the model it has today, so
      // that is a record, not a guess, and does not raise the flag. Without
      // this the card's "counted by the current model" line would be on
      // every view that includes today, which is every view.
      if (row.day !== today) fallback = true;
      add(currentModel(row.agentId) || UNKNOWN_MODEL, row.messages);
      continue;
    }
    for (const [model, n] of splitByCalls(row.messages, calls)) add(model, n);
  }

  const items = [...totals]
    .map(([model, n]) => ({ model, messages: n }))
    .sort((a, b) => b.messages - a.messages || a.model.localeCompare(b.model));
  return { items, fallback };
}
