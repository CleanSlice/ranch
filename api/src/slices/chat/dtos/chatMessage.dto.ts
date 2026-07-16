import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @ApiProperty({ example: 'Hello, how can I help?' }) text: string;

  @ApiProperty({ example: 1777562539964, description: 'Unix epoch ms' })
  ts: number;
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
