import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatSessionDto {
  @ApiProperty({ example: 'chat-9f2c…' })
  id: string;

  @ApiProperty() agentId: string;

  @ApiProperty({
    enum: ['bridle', 'telegram', 'slack', 'internal'],
    example: 'bridle',
  })
  channel: string;

  @ApiProperty({ example: 'admin' }) externalUserId: string;

  @ApiProperty({ example: 'bridle:admin' }) sessionKey: string;

  @ApiPropertyOptional({ nullable: true }) title: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Last message text, truncated',
  })
  preview: string | null;

  @ApiPropertyOptional({ enum: ['user', 'assistant'], nullable: true })
  lastRole: string | null;

  @ApiProperty({
    description: 'Unix ms via ISO',
    example: '2026-07-15T09:12:00.000Z',
  })
  lastMessageAt: Date;

  @ApiProperty({ description: 'Monotonic lifetime total' })
  messageCount: number;

  @ApiProperty() userMessageCount: number;

  @ApiPropertyOptional({ nullable: true }) summary: string | null;

  @ApiPropertyOptional({ nullable: true }) summaryAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'topics/sentiment/resolved/language',
  })
  insights: unknown;

  @ApiProperty() archived: boolean;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

export class ChatListResponseDto {
  @ApiProperty({ type: [ChatSessionDto] }) items: ChatSessionDto[];
  @ApiProperty({ example: 128 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 50 }) perPage: number;
}
