import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class TranscriptMessageDto {
  @ApiProperty({ example: 'c94dbcf2-64f1-4e84-9723-c94e2d815f61' })
  id: string;

  @ApiProperty({ enum: ['user', 'assistant'], example: 'assistant' })
  role: 'user' | 'assistant';

  @ApiProperty({ example: 'Hello, how can I help?' })
  text: string;

  @ApiProperty({
    example: 1777562539964,
    description: 'Unix epoch milliseconds.',
  })
  ts: number;
}

export class TranscriptQueryDto {
  @ApiPropertyOptional({
    example: 'admin',
    description: 'Session channel — defaults to "admin" for the admin app.',
  })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    default: 50,
    description:
      'Max messages to return in this page (newest first by file order).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque cursor returned by the previous page. Omit for the latest page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class TranscriptResponseDto {
  @ApiProperty({ type: [TranscriptMessageDto] })
  messages: TranscriptMessageDto[];

  @ApiProperty({
    example: 'admin',
    description: 'Channel the transcript was loaded from.',
  })
  channel: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Pass back as `cursor` to fetch the previous page. `null` when no older messages.',
  })
  nextCursor!: string | null;

  @ApiProperty({ example: false })
  hasMore!: boolean;
}
