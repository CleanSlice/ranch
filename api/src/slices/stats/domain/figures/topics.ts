import { IFigureDefinition } from '../figure.types';

/**
 * What a person's conversations were about (`ChatSession.topicIds` and
 * `question`, named through `ChatTopic`; chat slice, CLEAN-270): up to eight
 * topics of the period with their resolved and open parts, and under each
 * the person's main questions.
 *
 * Read in place: the summary writes the topics it assigned on the
 * conversation, and `ChatTopic` holds each subject once, with its labels
 * and, when an operator folded it into another, where it went. A count per
 * topic is not stored anywhere (docs/statistics.md): it is counted from the
 * conversations each time, here from the person's own of the period, which
 * the hour rows name, and their topics are then read by id
 * (`IChatTopicGateway.findByIds`, which follows a merge once).
 *
 * Personal only. A question is the person's own words and is shown to its
 * owner alone (spec 038, FR-033); the installation view has no topic block,
 * and an operator reads the installation's topics with `list_chat_topics`,
 * which carries no question.
 *
 * Nothing to rebuild and no first record, so never a "counted since" note
 * (CLEAN-262): `summaries` says how many of the period's conversations
 * have a summary to take a topic from.
 */
export const topicsFigure: IFigureDefinition = {
  key: 'topics',
  scopes: ['personal'],
};
