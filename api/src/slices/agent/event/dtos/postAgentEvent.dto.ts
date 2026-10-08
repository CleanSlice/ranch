import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  AGENT_REF_MAX_LENGTH,
  AgentEventOutcomeTypes,
  EVENT_ID_MAX_LENGTH,
  EXTERNAL_EVENT_STATUSES,
  ExternalEventStatusTypes,
  REASON_MAX_LENGTH,
  TOOL_MAX_LENGTH,
} from '../domain/agentEvent.types';

export class PostAgentEventDto {
  @ApiProperty({
    description:
      "The Ranch agent's id. On the agent's pod it is the label `ranch/agent-id`; the pod is named `agent-<agentId>` in namespace `agents`.",
    example: '3f6c1e0a-7b1d-4c58-9a51-0d8a2c6f4e11',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_REF_MAX_LENGTH)
  agentId: string;

  @ApiProperty({
    enum: EXTERNAL_EVENT_STATUSES,
    description:
      'What happened. `failed` opens (or joins) an incident; `recovered` is stored as evidence — an incident closes when Ranch itself has seen the agent running for ten minutes.',
    example: 'failed',
  })
  @IsIn(EXTERNAL_EVENT_STATUSES)
  status: ExternalEventStatusTypes;

  @ApiPropertyOptional({
    description:
      'When it happened, ISO 8601 with an offset. Left out: the time Ranch received the event.',
    example: '2026-10-06T21:14:03Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  datetime?: string;

  @ApiPropertyOptional({
    description: "The cause in the sender's own words. Shown as sent.",
    example: 'CrashLoopBackOff: back-off 5m0s restarting failed container',
    maxLength: REASON_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'The tool that noticed. Detail only: who sent the event is taken from the API key, not from this field.',
    example: 'kubernetes-event-exporter',
    maxLength: TOOL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TOOL_MAX_LENGTH)
  source?: string;

  @ApiPropertyOptional({
    description:
      "The sender's own id for this event. Makes a retry safe: the same eventId from the same key is stored once.",
    maxLength: EVENT_ID_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(EVENT_ID_MAX_LENGTH)
  eventId?: string;
}

const OUTCOMES: AgentEventOutcomeTypes[] = [
  'opened',
  'joined',
  'suppressed_stopped',
  'suppressed_starting',
  'unmatched',
  'evidence',
];

export class AgentEventAcceptedDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: OUTCOMES,
    description:
      'What the event did: `opened` an incident (the team is being told), `joined` one already open, was `suppressed_stopped` / `suppressed_starting` because a person stopped or is restarting the agent, was `unmatched` to any agent, or is `evidence` of a recovery.',
  })
  outcome: AgentEventOutcomeTypes;

  @ApiProperty({ nullable: true, type: String })
  incidentId: string | null;

  @ApiProperty({
    description:
      'true when Ranch already had this event; `id` is then the first copy.',
  })
  duplicate: boolean;
}
