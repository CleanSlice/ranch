import { ApiProperty } from '@nestjs/swagger';
import { ChatOutcome, ChatOutcomeTypes } from '#/chat/domain/chat.types';
import {
  IActivityDay,
  IComparedCount,
  IFigureNote,
  IModelAttribution,
  IModelShare,
  IPeriodRange,
  IPersonalActivity,
  IPersonalAgent,
  IPersonalBoard,
  IPersonalHelp,
  IPersonalOpenQuestion,
  IPersonalOpenQuestions,
  IPersonalOutcome,
  IPersonalResolved,
  IPersonalStats,
  IPersonalSummaries,
  IPersonalTopic,
  IPersonalTopicQuestion,
  PERIODS,
  PERSONAL_FIGURES,
  Period,
} from '../domain';

// The answer of `GET /me/stats` (CLEAN-258; spec 038, contracts/api.md).
// Every field is described here because both consoles' types are generated
// from it; nobody writes them by hand. Each class implements the domain
// shape it documents, so a field added to one and not the other does not
// compile.
//
// The blocks read from conversation summaries (`summaries`, `topics`,
// `outcome`, `openQuestions`, `board.resolved`, and `resolved` / `summarised`
// per agent; CLEAN-270) are always in the answer, with the same shape. On an
// installation that produces no summaries, the ordinary one, every count in
// them is 0 and every list empty, and `summaries.enabled` is false: the page
// decides by that field, never by a zero, between "nothing was left open"
// and "summaries are not produced".
//
// Topics have a second switch, `summaries.topicsReady` (CLEAN-270, the
// owner's decision of 2026-11-28): the installation has a vocabulary. While
// it has none `topics` is empty and no open question carries a topic, and
// the page leaves the topics block out by that field, never by the empty
// list, which also means "none of this period's conversations had a topic".

export class StatsRangeDto implements IPeriodRange {
  @ApiProperty({
    description: "Start of the period's first day in the viewer's zone.",
    example: '2026-11-20T22:00:00.000Z',
  })
  from: Date;

  @ApiProperty({
    description:
      'The moment the view was computed: the period includes today so far.',
    example: '2026-11-27T10:30:00.000Z',
  })
  to: Date;

  @ApiProperty({
    description:
      'Start of the period before this one, which has the same number of ' +
      'days and ends where this one starts.',
    example: '2026-11-13T22:00:00.000Z',
  })
  previousFrom: Date;
}

export class StatsNoteDto implements IFigureNote {
  @ApiProperty({
    description:
      'Which figure is not complete over the whole of the requested and ' +
      'the previous period.',
    enum: PERSONAL_FIGURES,
    example: 'activity',
  })
  figure: string;

  @ApiProperty({
    description:
      'Since when it is counted. Later than `range.previousFrom`; the page ' +
      'says "counted since …" once for the block.',
    example: '2026-11-24T08:00:00.000Z',
  })
  completeSince: Date;
}

export class StatsComparedCountDto implements IComparedCount {
  @ApiProperty({ description: 'In the period.', example: 12 })
  value: number;

  @ApiProperty({ description: 'In the period before it.', example: 9 })
  previous: number;
}

export class MyStatsBoardAgentsDto {
  @ApiProperty({
    description:
      "Agents that answered in the person's conversations in the period.",
    example: 3,
  })
  value: number;

  @ApiProperty({
    description: 'Agents the person reaches now.',
    example: 5,
  })
  reachable: number;
}

export class MyStatsSummariesDto implements IPersonalSummaries {
  @ApiProperty({
    description:
      'Whether this installation produces conversation summaries. False: ' +
      'the three counts here, `board.resolved`, `resolved` and `summarised` ' +
      'of every agent and all of `outcome` are 0, and `topics` and ' +
      '`openQuestions.items` are empty, because nothing about summaries is ' +
      'counted. Show one card in their place, not zeros.',
    example: true,
  })
  enabled: boolean;

  @ApiProperty({
    description:
      'Whether topics are there to show: summaries are produced and the ' +
      'installation has a vocabulary, at least one topic that stands. ' +
      'False: no conversation is asked about topics yet, so `topics` is ' +
      'empty and `topic` of every open question is null. Leave the topics ' +
      'block out then, and do not say that the conversations were about ' +
      'nothing. Everything else read from summaries is counted either ' +
      'way. Always false when `enabled` is false.',
    example: true,
  })
  topicsReady: boolean;

  @ApiProperty({
    description:
      "How many of the period's conversations have a summary. With " +
      '`waiting` and `tooShort` it adds up to `board.conversations.value`.',
    example: 9,
  })
  summarised: number;

  @ApiProperty({
    description:
      'Conversations without a summary yet that will get one: long ' +
      'enough, and the batch has not reached them. Not counted in topics ' +
      'or outcomes yet.',
    example: 2,
  })
  waiting: number;

  @ApiProperty({
    description:
      'Conversations without a summary that will not get one as they ' +
      'stand: under three messages from the person. Not a backlog.',
    example: 1,
  })
  tooShort: number;
}

export class MyStatsResolvedDto implements IPersonalResolved {
  @ApiProperty({
    description:
      'Conversations of the period whose summary says the person got what ' +
      'they asked for.',
    example: 6,
  })
  resolved: number;

  @ApiProperty({
    description:
      'Conversations of the period that have a summary: what the share is ' +
      'a share of. The same number as `summaries.summarised`.',
    example: 9,
  })
  summarised: number;
}

export class MyStatsBoardDto implements IPersonalBoard {
  @ApiProperty({
    type: StatsComparedCountDto,
    description:
      'Conversations the person wrote in. A conversation that went on from ' +
      'the previous period is counted in both.',
  })
  conversations: StatsComparedCountDto;

  @ApiProperty({
    type: StatsComparedCountDto,
    description: "The person's own messages.",
  })
  messages: StatsComparedCountDto;

  @ApiProperty({ type: MyStatsBoardAgentsDto })
  agents: MyStatsBoardAgentsDto;

  @ApiProperty({
    type: MyStatsResolvedDto,
    description:
      'The resolved share: `resolved` out of `summarised`. Both 0 when ' +
      '`summaries.enabled` is false, and `summarised` 0 while no ' +
      'conversation of the period has a summary: no share to show either ' +
      'way.',
  })
  resolved: MyStatsResolvedDto;
}

export class MyStatsDayDto implements IActivityDay {
  @ApiProperty({
    description: "The day, in the viewer's zone.",
    example: '2026-11-27',
  })
  date: string;

  @ApiProperty({
    description: 'Conversations the person wrote in on that day.',
    example: 2,
  })
  conversations: number;
}

export class MyStatsActivityDto implements IPersonalActivity {
  @ApiProperty({
    type: [MyStatsDayDto],
    description:
      'The last 91 days, oldest first, ending today, whatever the period: ' +
      '13 whole weeks for the calendar. A conversation written in on three ' +
      'days is on each of them, so the days of a period can add up to more ' +
      'than `board.conversations.value`.',
  })
  days: MyStatsDayDto[];

  @ApiProperty({
    type: [Number],
    minItems: 7,
    maxItems: 7,
    description:
      'Conversations by weekday within the period, Monday first: the same ' +
      'counts as `days`, added up per weekday.',
    example: [3, 5, 2, 0, 4, 0, 1],
  })
  weekdays: number[];

  @ApiProperty({
    description: 'Days of the period with at least one conversation.',
    example: 5,
  })
  activeDays: number;
}

export class MyStatsAgentDto implements IPersonalAgent {
  @ApiProperty() agentId: string;

  @ApiProperty({ example: 'Support Bot' }) name: string;

  @ApiProperty({
    description: "The person's own messages to this agent in the period.",
    example: 41,
  })
  messages: number;

  @ApiProperty({
    description:
      'Conversations with this agent the person wrote in during the period.',
    example: 6,
  })
  conversations: number;

  @ApiProperty({
    description:
      'The ones among those conversations whose summary says resolved. 0 ' +
      'when `summaries.enabled` is false.',
    example: 4,
  })
  resolved: number;

  @ApiProperty({
    description:
      'The ones among those conversations that have a summary: what ' +
      '`resolved` is a share of. 0 when `summaries.enabled` is false.',
    example: 5,
  })
  summarised: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The model the agent runs now, shown as received. Null when it has ' +
      'none.',
    example: 'claude-sonnet-4-6',
  })
  model: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'The last message in those conversations, whoever wrote it. Null ' +
      'only when they were removed while the view was being computed.',
    example: '2026-11-26T09:12:30.000Z',
  })
  lastMessageAt: Date | null;
}

const OUTCOMES = Object.values(ChatOutcomeTypes);

export class MyStatsTopicQuestionDto implements IPersonalTopicQuestion {
  @ApiProperty({
    description: 'The conversation the question was asked in.',
    example: 'chat-7c1f',
  })
  chatId: string;

  @ApiProperty() agentId: string;

  @ApiProperty({ example: 'Support Bot' }) agentName: string;

  @ApiProperty({
    maxLength: 120,
    description:
      "The person's main question in that conversation: one line, in " +
      'their language, as its summary worded it. Shown as received. It is ' +
      'in this answer because the answer is its owner’s; no other route ' +
      'or tool of the statistics carries it.',
    example: 'How do I change my plan?',
  })
  question: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: "The conversation's last message.",
    example: '2026-11-26T09:12:30.000Z',
  })
  at: Date;

  @ApiProperty({
    enum: OUTCOMES,
    description:
      'How that conversation ended. `unknown`: its summary could not tell; ' +
      'neither a resolved nor an open mark.',
    example: 'resolved',
  })
  outcome: ChatOutcome;
}

export class MyStatsTopicDto implements IPersonalTopic {
  @ApiProperty({
    description:
      'The topic. One that was merged into another is counted under that ' +
      'other, and only that one is listed.',
    example: 'topic-3f2a',
  })
  id: string;

  @ApiProperty({
    description:
      "The topic's name in the request's language (`Accept-Language`, " +
      'among the languages of the console), in English when it has none ' +
      'in that language.',
    example: 'Billing',
  })
  label: string;

  @ApiProperty({
    description:
      'Summarised conversations of the period that carry the topic. A ' +
      'conversation can carry two, so the topics can add up to more than ' +
      '`summaries.summarised`, and one with no topic is in none.',
    example: 5,
  })
  conversations: number;

  @ApiProperty({
    description: 'Of them, the ones resolved.',
    example: 3,
  })
  resolved: number;

  @ApiProperty({
    description:
      'Of them, the ones left open. With `resolved` it can be less than ' +
      '`conversations`: the rest ended `unknown`.',
    example: 1,
  })
  open: number;

  @ApiProperty({
    type: [MyStatsTopicQuestionDto],
    maxItems: 4,
    description:
      'Up to four main questions of those conversations, newest first, ' +
      'each wording once. Empty when no summary quoted a question.',
  })
  questions: MyStatsTopicQuestionDto[];
}

export class MyStatsSentimentDto {
  @ApiProperty({ example: 4 }) positive: number;

  @ApiProperty({ example: 3 }) neutral: number;

  @ApiProperty({ example: 1 }) mixed: number;

  @ApiProperty({ example: 1 }) negative: number;
}

export class MyStatsLanguageDto {
  @ApiProperty({
    description: 'ISO 639-1 code, lower case, as the summary judged it.',
    example: 'en',
  })
  code: string;

  @ApiProperty({
    description: 'Summarised conversations in that language.',
    example: 7,
  })
  conversations: number;
}

export class MyStatsOutcomeDto implements IPersonalOutcome {
  @ApiProperty({
    description:
      'Conversations whose summary says the person got what they asked for.',
    example: 6,
  })
  resolved: number;

  @ApiProperty({
    description: 'Conversations whose summary says they did not.',
    example: 2,
  })
  open: number;

  @ApiProperty({
    description:
      'Summarised, and the summary could not tell. In neither of the two ' +
      'above, and never under open questions.',
    example: 1,
  })
  unknown: number;

  @ApiProperty({
    description:
      'Conversations of the period with no summary: `summaries.waiting` ' +
      'and `summaries.tooShort` together. With the three above it adds up ' +
      'to `board.conversations.value`, except when `summaries.enabled` is ' +
      'false: all four are then 0 and stand for nothing.',
    example: 3,
  })
  notSummarised: number;

  @ApiProperty({
    type: MyStatsSentimentDto,
    description:
      'The tone of the summarised conversations, each in one of the four. ' +
      'A summary that stored no tone is in none, so they can add up to ' +
      'less than the summarised.',
  })
  sentiment: MyStatsSentimentDto;

  @ApiProperty({
    type: [MyStatsLanguageDto],
    description:
      'The languages of the summarised conversations, most first. Empty ' +
      'when none has a summary.',
  })
  languages: MyStatsLanguageDto[];
}

export class MyStatsOpenQuestionDto implements IPersonalOpenQuestion {
  @ApiProperty({
    description:
      'The conversation left open: what "Continue" opens, with `agentId`.',
    example: 'chat-7c1f',
  })
  chatId: string;

  @ApiProperty() agentId: string;

  @ApiProperty({ example: 'Support Bot' }) agentName: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 120,
    description:
      "The person's main question in it, shown as received. Null when the " +
      'summary found the conversation open and quoted no question.',
    example: 'Why was I charged twice?',
  })
  question: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The name of the conversation's first topic, as `topics[].label` " +
      'names it. Null when its summary assigned none, and for every ' +
      'question while `summaries.topicsReady` is false.',
    example: 'Billing',
  })
  topic: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: "The conversation's last message.",
    example: '2026-11-26T09:12:30.000Z',
  })
  at: Date;
}

export class MyStatsOpenQuestionsDto implements IPersonalOpenQuestions {
  @ApiProperty({
    type: [MyStatsOpenQuestionDto],
    maxItems: 4,
    description:
      'The newest four conversations of the period left open, newest ' +
      'first. Empty when none was, and when `summaries.enabled` is false: ' +
      'tell the two apart by that field.',
  })
  items: MyStatsOpenQuestionDto[];

  @ApiProperty({
    description:
      'How many more there are. `items` and `more` together are ' +
      '`outcome.open`.',
    example: 0,
  })
  more: number;
}

export class MyStatsSourceDto {
  @ApiProperty({
    description:
      "A knowledge base's name as it was last cited, or `web` for every " +
      'web page together.',
    example: 'Legal',
  })
  name: string;

  @ApiProperty({ description: 'Times it was cited.', example: 7 })
  citations: number;
}

export class MyStatsCitedDto {
  @ApiProperty({
    description:
      "How many of the period's conversations got at least one answer with " +
      'sources. Out of `board.conversations.value`, and never more.',
    example: 4,
  })
  conversations: number;

  @ApiProperty({
    type: [MyStatsSourceDto],
    maxItems: 2,
    description: 'The two most cited sources, most cited first.',
  })
  sources: MyStatsSourceDto[];
}

export class MyStatsTopPeerDto {
  @ApiProperty({
    description:
      "The peer's name. `A colleague` for an agent the person does not " +
      'reach, as the chat called it.',
    example: 'Billing',
  })
  name: string;

  @ApiProperty({ description: 'Times it was asked.', example: 3 })
  count: number;
}

export class MyStatsHandoversDto {
  @ApiProperty({
    description:
      'Questions an agent handed over to a peer while answering the ' +
      'person, whatever came of them.',
    example: 5,
  })
  total: number;

  @ApiProperty({ description: 'The ones the peer answered.', example: 4 })
  answered: number;

  @ApiProperty({
    type: MyStatsTopPeerDto,
    nullable: true,
    description: 'The peer asked most. Null when nothing was handed over.',
  })
  topPeer: MyStatsTopPeerDto | null;
}

export class MyStatsRatingsDto {
  @ApiProperty({ description: 'Answers rated up.', example: 6 })
  up: number;

  @ApiProperty({ description: 'Answers rated down.', example: 1 })
  down: number;
}

export class MyStatsHelpDto implements IPersonalHelp {
  @ApiProperty({ type: MyStatsCitedDto })
  cited: MyStatsCitedDto;

  @ApiProperty({ type: MyStatsHandoversDto })
  handovers: MyStatsHandoversDto;

  @ApiProperty({
    type: MyStatsRatingsDto,
    description: 'The ratings the person gave in the period.',
  })
  ratings: MyStatsRatingsDto;
}

export class MyStatsModelDto implements IModelShare {
  @ApiProperty({
    description:
      'The model, shown as received. `unknown` for messages to an agent ' +
      'that has no usage record for the day and no model now.',
    example: 'claude-sonnet-4-6',
  })
  model: string;

  @ApiProperty({
    description:
      "The person's messages attributed to it. Whole messages: the items " +
      'add up to `board.messages.value`.',
    example: 34,
  })
  messages: number;
}

export class MyStatsModelsDto implements IModelAttribution {
  @ApiProperty({
    type: [MyStatsModelDto],
    description: 'By messages, most first.',
  })
  items: MyStatsModelDto[];

  @ApiProperty({
    description:
      'True when at least one day had no usage record, so its messages ' +
      "were given to the agent's current model. Today is usually such a " +
      'day: an agent posts its usage at the end of the UTC day or when it ' +
      'shuts down.',
  })
  fallback: boolean;
}

export class MyStatsDto implements IPersonalStats {
  @ApiProperty({ enum: PERIODS, example: 30 })
  period: Period;

  @ApiProperty({
    description:
      'The zone the days were cut in: the `tz` that was sent, or `UTC` ' +
      'when it named no zone this server knows.',
    example: 'Europe/Kyiv',
  })
  timeZone: string;

  @ApiProperty({ type: StatsRangeDto })
  range: StatsRangeDto;

  @ApiProperty({
    type: [StatsNoteDto],
    description:
      'One entry for each figure whose history starts inside the requested ' +
      'or the previous period. Empty when every figure covers both.',
  })
  notes: StatsNoteDto[];

  @ApiProperty({
    type: MyStatsSummariesDto,
    description:
      'Whether conversation summaries are produced here, whether their ' +
      "topics are there to show, and how many of the period's " +
      'conversations have a summary, wait for one, or are too short for ' +
      'one.',
  })
  summaries: MyStatsSummariesDto;

  @ApiProperty({ type: MyStatsBoardDto })
  board: MyStatsBoardDto;

  @ApiProperty({ type: MyStatsActivityDto })
  activity: MyStatsActivityDto;

  @ApiProperty({
    type: [MyStatsAgentDto],
    description:
      'The agents the person wrote to in the period, by their messages, ' +
      'most first.',
  })
  agents: MyStatsAgentDto[];

  @ApiProperty({
    type: [MyStatsTopicDto],
    maxItems: 8,
    description:
      "What the period's summarised conversations were about: up to " +
      'eight topics, most conversations first. Empty when no summarised ' +
      'conversation has a topic, when `summaries.enabled` is false, and ' +
      'while `summaries.topicsReady` is false: the installation has no ' +
      'vocabulary yet, and no conversation is asked about topics.',
  })
  topics: MyStatsTopicDto[];

  @ApiProperty({
    type: MyStatsOutcomeDto,
    description:
      "How the period's conversations ended. All zeros and no language " +
      'when `summaries.enabled` is false.',
  })
  outcome: MyStatsOutcomeDto;

  @ApiProperty({ type: MyStatsOpenQuestionsDto })
  openQuestions: MyStatsOpenQuestionsDto;

  @ApiProperty({ type: MyStatsHelpDto })
  help: MyStatsHelpDto;

  @ApiProperty({ type: MyStatsModelsDto })
  models: MyStatsModelsDto;
}
