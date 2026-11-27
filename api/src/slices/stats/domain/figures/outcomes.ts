import { IFigureDefinition } from '../figure.types';

/**
 * How conversations ended (`ChatSession.outcome` with `summaryAt`, chat
 * slice, CLEAN-270): resolved, left open or unknown, with the tone and the
 * language the same summary judged. A person's own in the board's resolved
 * share, "How it ends" and the open questions; per agent, as the share left
 * open, in the installation's quality block.
 *
 * Read in place. A summary writes its judgment on the conversation it is
 * about, and a later summary of the same conversation replaces it, so the
 * column is the fact and a counter beside it would have to follow every
 * rewrite. Which conversations belong to a period is not asked of
 * `ChatSession`: the hour rows name them (`IChatGateway
 * .findOutcomesForSessions` by their ids for a person;
 * `IChatActivityGateway.summaryForAgents` with `outcomes`, which joins
 * them to their summaries in the statement that counts them, for an
 * installation).
 *
 * Nothing to rebuild, and no first record, so never a "counted since" note
 * (CLEAN-262). How much of a period it covers is said another way, and
 * exactly: `summaries` counts the conversations that have a summary, the
 * ones waiting for one and the ones too short for one, and the
 * installation's rows carry `summarised` beside `open`. An installation
 * that produces no summaries says so with `summaries.enabled`, and the
 * figure is then not read at all.
 */
export const outcomesFigure: IFigureDefinition = {
  key: 'outcomes',
  scopes: ['personal', 'installation'],
};
