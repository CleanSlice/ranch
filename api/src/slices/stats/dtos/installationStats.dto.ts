import { ApiProperty } from '@nestjs/swagger';
import {
  ActivityChannel,
  ActivityChannelTypes,
} from '#/chat/domain/chat.types';
import {
  IFigureNote,
  IInstallationAgent,
  IInstallationBoard,
  IInstallationChannel,
  IInstallationCost,
  IInstallationDay,
  IInstallationDayModel,
  IInstallationHealth,
  IInstallationIncident,
  IInstallationModel,
  IInstallationQuality,
  IInstallationSummaries,
  IInstallationReach,
  IInstallationRefusals,
  IInstallationStats,
  INCIDENTS_SHOWN,
  INSTALLATION_NOTED_FIGURES,
  IPeriodRange,
  PERIODS,
  Period,
} from '../domain';
import { StatsComparedCountDto } from './myStats.dto';

// The answer of `GET /stats/installation` (CLEAN-265; spec 038,
// contracts/api.md). Every field is described here because the console's
// types are generated from it; nobody writes them by hand. Each class
// implements the domain shape it documents, so a field added to one and not
// the other does not compile.
//
// Counts, sums, names of agents and models, incidents and times. No field
// holds a person's name, a chat identity, a question or a message (FR-021).

export class InstallationStatsRangeDto implements IPeriodRange {
  @ApiProperty({
    description: "Start of the period's first UTC day.",
    example: '2026-10-29T00:00:00.000Z',
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
      'UTC days and ends where this one starts.',
    example: '2026-09-29T00:00:00.000Z',
  })
  previousFrom: Date;
}

export class InstallationStatsReachDto implements IInstallationReach {
  @ApiProperty({
    description:
      'True when some agent is hidden from the caller, so every figure ' +
      'here is of a part of the installation. The page says so.',
  })
  limited: boolean;

  @ApiProperty({
    description: 'Agents the caller reaches now.',
    example: 12,
  })
  agents: number;

  @ApiProperty({
    type: [String],
    description:
      'Names of the agents the caller reaches whose conversations are ' +
      'left out of `board.people`, `quality` and `channels`, because ' +
      'only the Owner manages them: for an Admin, the Ranch assistant. ' +
      'What such an agent spent, its incidents and its refused requests ' +
      'are counted as for any other agent. Empty for the Owner, and for a ' +
      'caller who does not reach such an agent. When it is not empty the ' +
      'page says whose conversations are not counted.',
    example: ['Ranch'],
  })
  ownerOnly: string[];
}

export class InstallationStatsNoteDto implements IFigureNote {
  @ApiProperty({
    description:
      'Which figure is not complete over the whole of the requested and ' +
      'the previous period: `activity` is people, conversations and ' +
      'channels, `refusals` the requests refused by limits. Spend, ratings ' +
      'and incidents are read where they are recorded and never have one.',
    enum: INSTALLATION_NOTED_FIGURES,
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

export class InstallationStatsTokensDto {
  @ApiProperty({ description: 'Tokens sent to models.', example: 48200000 })
  input: number;

  @ApiProperty({ description: 'Tokens models wrote.', example: 3100000 })
  output: number;
}

export class InstallationStatsCostDto implements IInstallationCost {
  @ApiProperty({
    description:
      "USD in the period, from the product's own price list: an estimate, " +
      'not an invoice. Models without a price are left out of it.',
    example: 212.4,
  })
  value: number;

  @ApiProperty({
    description: 'The same for the period before it.',
    example: 187.9,
  })
  previous: number;

  @ApiProperty({
    type: [String],
    description:
      'Models used in the period that the price list does not have, most ' +
      'tokens first. Their tokens are counted, their cost is in no sum ' +
      'here: show them as "no price", never as free.',
    example: ['house-model-1'],
  })
  unpriced: string[];
}

export class InstallationStatsBoardDto implements IInstallationBoard {
  @ApiProperty({ type: InstallationStatsTokensDto })
  tokens: InstallationStatsTokensDto;

  @ApiProperty({
    type: StatsComparedCountDto,
    description: 'Model calls.',
  })
  calls: StatsComparedCountDto;

  @ApiProperty({ type: InstallationStatsCostDto })
  cost: InstallationStatsCostDto;

  @ApiProperty({
    type: StatsComparedCountDto,
    description:
      'Distinct people who wrote in a conversation. Scheduled jobs and ' +
      "other agents' questions are not people and are not counted. A " +
      'person who wrote in both periods is counted in both. Conversations ' +
      'with an agent named in `reach.ownerOnly` are not counted.',
  })
  people: StatsComparedCountDto;
}

export class InstallationStatsDayModelDto implements IInstallationDayModel {
  @ApiProperty({
    description: 'The model, shown as received.',
    example: 'claude-sonnet-4-6',
  })
  model: string;

  @ApiProperty({
    description: 'Input and output tokens together.',
    example: 1650000,
  })
  tokens: number;
}

export class InstallationStatsDayDto implements IInstallationDay {
  @ApiProperty({ description: 'The UTC day.', example: '2026-11-25' })
  date: string;

  @ApiProperty({
    description:
      "USD of the day's priced models. 0 for a day nobody reported usage " +
      'for, and for a day of unpriced models alone.',
    example: 7.35,
  })
  cost: number;

  @ApiProperty({
    type: [InstallationStatsDayModelDto],
    description:
      'Tokens of the day by model, most first. Empty for a day with no ' +
      'usage. Today is usually short: an agent posts its usage at the end ' +
      'of the UTC day or when it shuts down.',
  })
  byModel: InstallationStatsDayModelDto[];
}

export class InstallationStatsModelDto implements IInstallationModel {
  @ApiProperty({ example: 'claude-sonnet-4-6' })
  model: string;

  @ApiProperty({
    description: 'Whether the price list has it. False is "no price".',
  })
  priced: boolean;
}

export class InstallationStatsAgentDto implements IInstallationAgent {
  @ApiProperty() agentId: string;

  @ApiProperty({
    description:
      'The name the agent has now. For one that no longer exists, the ' +
      'name its usage was last reported under.',
    example: 'Support Bot',
  })
  name: string;

  @ApiProperty({
    description:
      'True when the agent no longer exists. What it spent stays in the ' +
      'period it was spent in.',
  })
  removed: boolean;

  @ApiProperty({
    description: 'The model that took most of its tokens in the period.',
    example: 'claude-sonnet-4-6',
  })
  model: string;

  @ApiProperty({
    description: 'Input and output tokens together.',
    example: 9400000,
  })
  tokens: number;

  @ApiProperty({ description: 'Model calls.', example: 812 })
  calls: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'USD over the models of this agent that have a price. Null when ' +
      'none of them has one: "no price", not zero.',
    example: 61.2,
  })
  cost: number | null;

  @ApiProperty({
    description:
      'True when `cost` leaves out a model of this agent that has no ' +
      'price: the figure is of the rest, not of everything it ran.',
    example: false,
  })
  partial: boolean;
}

export class InstallationStatsIncidentDto implements IInstallationIncident {
  @ApiProperty({
    description: 'The short handle people use: "#12".',
    example: 12,
  })
  number: number;

  @ApiProperty({
    description: "The agent's name when the incident opened.",
    example: 'Support Bot',
  })
  agentName: string;

  @ApiProperty({ description: 'True while it is still going on.' })
  open: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The first failure's cause, in the sender's words, shown as " +
      'received. Null when none was given.',
    example: 'OOMKilled',
  })
  reason: string | null;

  @ApiProperty({ example: '2026-11-25T08:02:11.000Z' })
  openedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null while the incident is open.',
    example: '2026-11-25T08:40:00.000Z',
  })
  closedAt: Date | null;
}

export class InstallationStatsRefusalsDto implements IInstallationRefusals {
  @ApiProperty() agentId: string;

  @ApiProperty({ example: 'Support Bot' }) name: string;

  @ApiProperty({
    description:
      'Requests its limits refused in the period. Always above zero: an ' +
      'agent that refused nothing is not listed.',
    example: 37,
  })
  refused: number;
}

export class InstallationStatsHealthDto implements IInstallationHealth {
  @ApiProperty({
    type: [InstallationStatsIncidentDto],
    maxItems: INCIDENTS_SHOWN,
    description:
      'Incidents opened in the period, and older ones that are still ' +
      `open, newest first. At most ${INCIDENTS_SHOWN}; \`incidentsTotal\` ` +
      'says how many there are.',
  })
  incidents: InstallationStatsIncidentDto[];

  @ApiProperty({
    description:
      'How many incidents the period has, the ones not listed included.',
    example: 3,
  })
  incidentsTotal: number;

  @ApiProperty({
    type: [InstallationStatsRefusalsDto],
    description:
      'Agents whose limits refused at least one request, most first.',
  })
  refusals: InstallationStatsRefusalsDto[];
}

// `open` and `summarised` (the share of conversations left open) are read
// from the outcome a version 2 summary stores (CLEAN-270), and are always in
// the row. Where the installation produces no summaries both are 0 and
// `summaries.enabled` is false: the page decides by that field, never by a
// zero, between "none was left open" and "not counted".
export class InstallationStatsQualityDto implements IInstallationQuality {
  @ApiProperty() agentId: string;

  @ApiProperty({ example: 'Support Bot' }) name: string;

  @ApiProperty({
    description: 'Conversations a person wrote in during the period.',
    example: 240,
  })
  conversations: number;

  @ApiProperty({
    description: 'Ratings of its answers that were down. Out of `rated`.',
    example: 4,
  })
  down: number;

  @ApiProperty({
    description:
      'Every rating its answers got in the period, up or down. Ratings ' +
      'are read as they stand now: one withdrawn since is not counted.',
    example: 31,
  })
  rated: number;

  @ApiProperty({
    description:
      'Of `summarised`, the conversations whose summary says the person ' +
      'was left without what they asked for. A summary that could not ' +
      'tell is not among them. 0 when `summaries.enabled` is false: not ' +
      'counted, which is not "none".',
    example: 21,
  })
  open: number;

  @ApiProperty({
    description:
      'Of `conversations`, the ones that have a summary: what the open ' +
      'share is a share of. Show it with the share: 1 open of 3 summarised ' +
      'and 100 of 300 are the same share and not the same news. 0 when ' +
      '`summaries.enabled` is false, and while no conversation of the ' +
      'agent has a summary: no share to show either way.',
    example: 300,
  })
  summarised: number;
}

export class InstallationStatsSummariesDto implements IInstallationSummaries {
  @ApiProperty({
    description:
      'Whether this installation produces conversation summaries: the ' +
      'batch is scheduled and has a credential it can use. False: `open` ' +
      'and `summarised` of every `quality` row are 0 because nothing was ' +
      'counted. Say "summaries are not produced" there, never "no ' +
      'conversation was left open".',
    example: true,
  })
  enabled: boolean;
}

export class InstallationStatsChannelDto implements IInstallationChannel {
  @ApiProperty({
    enum: Object.values(ActivityChannelTypes),
    description:
      'Where people wrote from: `console` is the chat of the consoles, ' +
      '`share` a share link, `other` anything that is none of the four.',
    example: 'console',
  })
  channel: ActivityChannel;

  @ApiProperty({
    description: 'Conversations a person wrote in during the period.',
    example: 512,
  })
  conversations: number;
}

export class InstallationStatsDto implements IInstallationStats {
  @ApiProperty({ enum: PERIODS, example: 30 })
  period: Period;

  @ApiProperty({
    type: InstallationStatsRangeDto,
    description:
      'UTC days, whoever is looking: the boundary spend is reported on.',
  })
  range: InstallationStatsRangeDto;

  @ApiProperty({ type: InstallationStatsReachDto })
  reach: InstallationStatsReachDto;

  @ApiProperty({
    type: [InstallationStatsNoteDto],
    description:
      'One entry for each figure whose history starts inside the requested ' +
      'or the previous period. Empty when every figure covers both.',
  })
  notes: InstallationStatsNoteDto[];

  @ApiProperty({
    type: InstallationStatsSummariesDto,
    description:
      'Whether conversation summaries are produced here: what the open ' +
      'share of `quality` is read from.',
  })
  summaries: InstallationStatsSummariesDto;

  @ApiProperty({ type: InstallationStatsBoardDto })
  board: InstallationStatsBoardDto;

  @ApiProperty({
    type: [InstallationStatsDayDto],
    description:
      'One entry per UTC day of the period, oldest first, today last; a ' +
      'day with no usage is there with nothing.',
  })
  daily: InstallationStatsDayDto[];

  @ApiProperty({
    type: [InstallationStatsModelDto],
    description:
      'Every model used in the period, most tokens first: the legend of ' +
      '`daily`.',
  })
  models: InstallationStatsModelDto[];

  @ApiProperty({
    type: [InstallationStatsAgentDto],
    description:
      'The agents that reported usage in the period, by cost, most first; ' +
      'agents with no price come after them, by tokens.',
  })
  agents: InstallationStatsAgentDto[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "USD for 30 days at the pace of the period's finished days: their " +
      'priced cost, divided by their number, times 30. Today is left out, ' +
      'and so are the days before anybody reported usage. Null while no ' +
      'such day is finished, and when no model with a price ran in those ' +
      'days: "no projection yet", not zero.',
    example: 212.4,
  })
  projection30d: number | null;

  @ApiProperty({ type: InstallationStatsHealthDto })
  health: InstallationStatsHealthDto;

  @ApiProperty({
    type: [InstallationStatsQualityDto],
    description:
      'Per agent with a conversation or a rating in the period: how many ' +
      'conversations, how its answers were rated, and how many of the ' +
      'conversations that have a summary were left open. Most ' +
      'conversations first.',
  })
  quality: InstallationStatsQualityDto[];

  @ApiProperty({
    type: [InstallationStatsChannelDto],
    description:
      "The period's conversations by channel, most first. A channel " +
      'nobody wrote on is absent.',
  })
  channels: InstallationStatsChannelDto[];
}
