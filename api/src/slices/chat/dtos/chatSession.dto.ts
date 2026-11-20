import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The signed-in person a conversation is with (CLEAN-236). */
export class ChatPersonDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null once the account no longer exists.',
    example: 'Ada Lovelace',
  })
  name: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Admin' })
  role: string | null;
}

/** The agent a conversation was handed over by (CLEAN-236). */
export class ChatPeerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The asking agent's name, when the caller has access to that agent. " +
      "Null otherwise: the conversation is then a colleague's, and no more.",
    example: 'Front Desk',
  })
  name: string | null;
}

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

  @ApiPropertyOptional({
    type: ChatPersonDto,
    nullable: true,
    description:
      'The signed-in person the conversation is with, by name: an account, ' +
      'or the Owner for `externalUserId: "admin"`. Null for a visitor, a ' +
      'messenger chat and another agent.',
  })
  person?: ChatPersonDto | null;

  @ApiPropertyOptional({
    type: ChatPeerDto,
    nullable: true,
    description:
      'Set when the conversation is a question another agent handed over ' +
      '(`externalUserId` starts with `peer:`). Null otherwise.',
  })
  peer?: ChatPeerDto | null;
}

export class ChatListResponseDto {
  @ApiProperty({ type: [ChatSessionDto] }) items: ChatSessionDto[];
  @ApiProperty({ example: 128 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 50 }) perPage: number;
}
