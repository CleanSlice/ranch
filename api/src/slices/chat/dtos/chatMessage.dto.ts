import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TranscriptAttachmentDto } from '#/bridle/dtos/transcript.dto';

export class ChatMessageDto {
  @ApiProperty({ example: 'c94dbcf2-…' }) id: string;

  @ApiProperty({
    enum: [
      'user',
      'assistant',
      'summary',
      'tool_call',
      'tool_result',
      'system',
    ],
    example: 'assistant',
  })
  role: string;

  @ApiProperty({
    example: 'Hello, how can I help?',
    description:
      'For user messages: what the person typed, without the attachment ' +
      'contents the API inlined for the model.',
  })
  text: string;

  @ApiProperty({ example: 1777562539964, description: 'Unix epoch ms' })
  ts: number;

  @ApiPropertyOptional({
    type: [TranscriptAttachmentDto],
    description:
      'Files sent with this message (metadata only; history has no download route).',
  })
  attachments?: TranscriptAttachmentDto[];

  @ApiPropertyOptional({
    description:
      'Admin debug views only (present when `types` includes tool events): ' +
      'the full text the model received for a user message with attachments.',
  })
  agentText?: string;
}

export class ChatMessagesResponseDto {
  @ApiProperty({ type: [ChatMessageDto] }) messages: ChatMessageDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Pass to fetch the previous (older) page',
  })
  nextCursor: string | null;

  @ApiProperty() hasMore: boolean;
}

export class ChatMessagesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated event types (debug toggle). Default user,assistant,summary. ' +
      'Admins may add tool_call,tool_result,system.',
    example: 'user,assistant,summary,tool_call,tool_result',
  })
  @IsOptional()
  @IsString()
  types?: string;
}
