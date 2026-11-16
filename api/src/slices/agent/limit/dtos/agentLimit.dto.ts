import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';
import { LIMIT_MAX, LIMIT_WINDOWS, LimitWindow } from '../domain';

const WINDOW_NOTE =
  'Null or absent means this window is not limited. A whole number from 1 to ' +
  `${LIMIT_MAX}; a longer window may not allow fewer requests than a shorter one.`;

/**
 * Request limits of one agent (CLEAN-224): how many requests it accepts in
 * any 60 seconds, 60 minutes and 24 hours, from everyone together. Range and
 * consistency are checked by the domain rules, which answer with a `code` the
 * console can place next to the right field — so the validators here only
 * keep non-numbers out.
 */
export class SetAgentLimitsDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: `Requests accepted in any 60 seconds. ${WINDOW_NOTE}`,
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  perMinute?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: `Requests accepted in any 60 minutes. ${WINDOW_NOTE}`,
    example: 300,
  })
  @IsOptional()
  @IsNumber()
  perHour?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: `Requests accepted in any 24 hours. ${WINDOW_NOTE}`,
    example: 2000,
  })
  @IsOptional()
  @IsNumber()
  perDay?: number | null;
}

export class AgentLimitsDto {
  @ApiProperty({ type: Number, nullable: true, example: 20 })
  perMinute: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 300 })
  perHour: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  perDay: number | null;
}

/** What `GET` and `PUT /agents/:id/limits` answer. */
export class AgentLimitsStateDto {
  @ApiProperty({
    type: AgentLimitsDto,
    nullable: true,
    description: 'Null when limits are off for this agent.',
  })
  limits: AgentLimitsDto | null;
}

/** The only thing a signed-in user who cannot edit the agent may learn. */
export class AgentLimitsEnabledDto {
  @ApiProperty({ description: 'True when the agent has at least one limit.' })
  enabled: boolean;
}

export class AgentLimitSummaryDto {
  @ApiProperty()
  agentId: string;

  @ApiProperty({ description: 'The agent has at least one limit.' })
  enabled: boolean;

  @ApiProperty({
    description:
      'A limit is full right now: the next visitor request is refused.',
  })
  atLimit: boolean;

  @ApiProperty({
    description:
      'Public with no limits. Only possible for an agent that was public ' +
      'before limits existed; its next visibility save requires them.',
  })
  needsLimits: boolean;
}

export class AgentLoadWindowDto {
  @ApiProperty({ enum: LIMIT_WINDOWS })
  window: LimitWindow;

  @ApiProperty({ description: 'Requests accepted in this window so far.' })
  used: number;

  @ApiProperty({ type: Number, nullable: true })
  limit: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds until this window has room again; null while it has room.',
  })
  retryAfterSec: number | null;
}

export class AgentLoadMinuteDto {
  @ApiProperty({ description: 'Start of the minute, ISO 8601 (UTC).' })
  minute: string;

  @ApiProperty()
  accepted: number;

  @ApiProperty()
  refused: number;

  @ApiProperty({
    description:
      'Operator and agent-to-agent requests; not counted toward limits.',
  })
  exempt: number;
}

export class AgentLoadByWindowDto {
  @ApiProperty()
  minute: number;

  @ApiProperty()
  hour: number;

  @ApiProperty()
  day: number;
}

export class AgentLoadRefusedDto {
  @ApiProperty({
    description: 'Requests refused for a limit in the last 60 minutes.',
  })
  lastHour: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ISO 8601, or null.',
  })
  lastAt: string | null;

  @ApiProperty({
    type: AgentLoadByWindowDto,
    description:
      'Refusals in the last 60 minutes by the window that set the wait.',
  })
  byWindow: AgentLoadByWindowDto;
}

/** The live picture of one agent, for the people who may edit it. */
export class AgentLoadDto {
  @ApiProperty({ type: AgentLimitsDto, nullable: true })
  limits: AgentLimitsDto | null;

  @ApiProperty()
  isPublic: boolean;

  @ApiProperty()
  needsLimits: boolean;

  @ApiProperty({ type: [AgentLoadWindowDto] })
  windows: AgentLoadWindowDto[];

  @ApiProperty({ description: 'Conversations with a turn open right now.' })
  inFlight: number;

  @ApiProperty({
    type: [AgentLoadMinuteDto],
    description: 'The last 60 minutes, oldest first, empty minutes included.',
  })
  series: AgentLoadMinuteDto[];

  @ApiProperty({ type: AgentLoadRefusedDto })
  refused: AgentLoadRefusedDto;

  @ApiProperty({
    description: 'Operator and agent-to-agent requests in the last 60 minutes.',
  })
  exemptLastHour: number;

  @ApiProperty({
    type: AgentLoadByWindowDto,
    description:
      'Highest number of accepted requests in any minute, hour and day of the last 30 days.',
  })
  peaks: AgentLoadByWindowDto;

  @ApiProperty({
    description:
      'Live copies of the API. Above 1 these figures are the share of one copy only.',
  })
  apiReplicas: number;
}
