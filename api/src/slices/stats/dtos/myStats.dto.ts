import { ApiProperty } from '@nestjs/swagger';
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
  IPersonalStats,
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
// The blocks that depend on conversation summaries (`summaries`, `topics`,
// `outcome`, `openQuestions`, `board.resolved`, and `resolved` / `summarised`
// per agent) are not in this answer yet. They arrive with summaries of
// version 2; until then the page reads their absence as "not counted yet".

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

  @ApiProperty({ type: MyStatsHelpDto })
  help: MyStatsHelpDto;

  @ApiProperty({ type: MyStatsModelsDto })
  models: MyStatsModelsDto;
}
