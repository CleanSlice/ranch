import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Body of `POST /share/resolve`. The token shape is validated up front so a
 *  malformed link never reaches the database — 400, not 404. */
export class ShareResolveRequestDto {
  @ApiProperty({
    description:
      'The share token from the link (`sl_` + 43 url-safe characters).',
    pattern: '^sl_[A-Za-z0-9_-]{43}$',
    example: 'sl_mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU',
  })
  @IsString()
  @Matches(/^sl_[A-Za-z0-9_-]{43}$/)
  token: string;
}

/** A skill of the agent's template, as a visitor sees it. */
export class ShareSkillDto {
  @ApiProperty({ example: 'Order tracking' })
  title: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Finds an order by its number and reports where it is.',
  })
  description: string | null;
}

/**
 * The agent's configured request limits, values only. The allowance is one
 * per agent, shared by everyone who talks to it — how much of it is spent is
 * not here and reaches no anonymous caller.
 */
export class ShareLimitsDto {
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Requests accepted in any 60 seconds; null = not limited.',
    example: null,
  })
  perMinute: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Requests accepted in any 60 minutes; null = not limited.',
    example: 20,
  })
  perHour: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Requests accepted in any 24 hours; null = not limited.',
    example: 100,
  })
  perDay: number | null;
}

/** What the visitor may attach — the limits the upload route enforces. */
export class ShareAttachmentsDto {
  @ApiProperty({ description: 'Attachments per message.', example: 5 })
  maxPerMessage: number;

  @ApiProperty({ description: 'Largest single file, bytes.', example: 10485760 })
  maxFileBytes: number;

  @ApiProperty({
    description: 'Largest combined attachments on one message, bytes.',
    example: 26214400,
  })
  maxMessageBytes: number;

  @ApiProperty({
    description: 'Accepted file families.',
    enum: ['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text'],
    isArray: true,
  })
  kinds: string[];
}

/**
 * Everything a share visitor learns about the agent behind a link: what it
 * is for and what it accepts (CLEAN-237). An allowlist — no config, no
 * resources, no workflow, no status reason (FR-014).
 */
export class ShareResolvedDto {
  @ApiProperty({
    description: 'Id of the shared agent — used for the chat requests.',
    example: 'a1b2c3d4-0000-4000-8000-000000000001',
  })
  agentId: string;

  @ApiProperty({
    description: 'Display name of the shared agent.',
    example: 'Support bot',
  })
  agentName: string;

  @ApiProperty({
    description:
      "The agent's persisted status (running | unreachable | deploying | " +
      "stopped | failed | …). 'running' means the chat is live.",
    example: 'running',
  })
  agentStatus: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "What the agent is for: its own description, else its template's, " +
      'else null. At most 500 characters.',
    example: 'Answers questions about orders, returns and delivery.',
  })
  description: string | null;

  @ApiProperty({
    type: [ShareSkillDto],
    description: "The skills of the agent's template. Empty when it has none.",
  })
  skills: ShareSkillDto[];

  @ApiProperty({
    nullable: true,
    type: ShareLimitsDto,
    description: 'Null when the agent has no request limits.',
  })
  limits: ShareLimitsDto | null;

  @ApiProperty({ type: ShareAttachmentsDto })
  attachments: ShareAttachmentsDto;
}
