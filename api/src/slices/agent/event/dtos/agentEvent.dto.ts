import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AgentEventOutcomeTypes,
  AgentEventStatusTypes,
  AgentEventWitnessTypes,
  EVENT_PAGE_MAX,
  IncidentResolutionTypes,
  NotificationKindTypes,
  NotificationStatusTypes,
} from '../domain/agentEvent.types';

const CURSOR_MAX_LENGTH = 200;

export class ListAgentEventsQueryDto {
  @ApiPropertyOptional({ description: 'Only this agent’s events.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  agentId?: string;

  @ApiPropertyOptional({ default: 50, maximum: EVENT_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EVENT_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description: 'The `nextCursor` of a previous answer — the page after it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  before?: string;
}

export class ListAgentIncidentsQueryDto extends ListAgentEventsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  state?: 'open' | 'closed';
}

export class AgentEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null when the id matched no agent, or the agent is gone.',
  })
  agentId: string | null;

  @ApiProperty({ description: 'The agent id exactly as the sender gave it.' })
  agentRef: string;

  @ApiProperty({ nullable: true, type: String })
  agentName: string | null;

  @ApiProperty({ enum: ['failed', 'unreachable', 'recovered'] })
  status: AgentEventStatusTypes;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'As received. Never translated or reformatted.',
  })
  reason: string | null;

  @ApiProperty({ enum: ['ranch', 'external'] })
  witness: AgentEventWitnessTypes;

  @ApiProperty({
    description: 'The API key’s name at the time, or "Ranch".',
  })
  senderName: string;

  @ApiProperty({ nullable: true, type: String })
  tool: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'What Ranch held for the agent when the event arrived.',
  })
  ranchStatus: string | null;

  @ApiProperty({
    enum: [
      'opened',
      'joined',
      'suppressed_stopped',
      'suppressed_starting',
      'unmatched',
      'evidence',
    ],
  })
  outcome: AgentEventOutcomeTypes;

  @ApiProperty({ nullable: true, type: String })
  incidentId: string | null;

  @ApiProperty()
  occurredAt: Date;

  @ApiProperty()
  receivedAt: Date;
}

export class AgentEventPageDto {
  @ApiProperty({ type: [AgentEventDto] })
  items: AgentEventDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}

export class AgentIncidentNotificationDto {
  @ApiProperty({ enum: ['opened', 'closed'] })
  kind: NotificationKindTypes;

  @ApiProperty({ enum: ['pending', 'sent', 'failed', 'skipped'] })
  status: NotificationStatusTypes;

  @ApiProperty()
  attempts: number;

  @ApiProperty({ nullable: true, type: Date })
  sentAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The destination’s answer. Never its address.',
  })
  lastError: string | null;
}

export class AgentIncidentDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: String })
  agentId: string | null;

  @ApiProperty()
  agentName: string;

  @ApiProperty({ enum: ['open', 'closed'] })
  state: 'open' | 'closed';

  @ApiProperty({ enum: ['failed', 'unreachable'] })
  status: 'failed' | 'unreachable';

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ type: [String], description: 'Sender names, Ranch included.' })
  witnesses: string[];

  @ApiProperty()
  ranchWitnessed: boolean;

  @ApiProperty()
  eventCount: number;

  @ApiProperty()
  openedAt: Date;

  @ApiProperty()
  lastFailureAt: Date;

  @ApiProperty({
    nullable: true,
    type: Date,
    description:
      'When Ranch last saw the agent come up. Set while the incident is still open: the agent is recovering.',
  })
  upSince: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  closedAt: Date | null;

  @ApiProperty({
    nullable: true,
    enum: ['recovered', 'unconfirmed', 'stopped', 'deleted'],
  })
  resolution: IncidentResolutionTypes | null;

  @ApiProperty({ type: [AgentIncidentNotificationDto] })
  notifications: AgentIncidentNotificationDto[];
}

export class AgentIncidentPageDto {
  @ApiProperty({ type: [AgentIncidentDto] })
  items: AgentIncidentDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
