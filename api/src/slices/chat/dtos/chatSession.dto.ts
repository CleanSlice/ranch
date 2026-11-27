import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IChatSessionData } from '../domain';

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

  // What version 2 of the summary adds (CLEAN-270). Additive and optional:
  // the admin console's chat pages keep reading `insights`.
  @ApiPropertyOptional({
    type: String,
    enum: ['resolved', 'open', 'unknown'],
    nullable: true,
    description:
      'How the conversation ended, by its latest summary. `unknown`: the ' +
      'summary could not tell. Null while there is no summary.',
    example: 'resolved',
  })
  outcome?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 120,
    description:
      'The person’s main question, one line, in their language. Null ' +
      'while there is no summary, or when they asked for nothing.',
    example: 'How do I change my plan?',
  })
  question?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Labels of the topics the summary assigned, at most two. On ' +
      '`/me/chats` in the language of `Accept-Language` when the console ' +
      'has it, English otherwise; on `/chats` always English.',
    example: ['Billing'],
  })
  topics?: string[];

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

/**
 * A conversation as a chat route answers it: the fields `ChatSessionDto`
 * declares, one by one, and what the route adds to them (the topics by
 * label; who the conversation is with).
 *
 * The routes used to spread the whole index row into the answer (CLEAN-270,
 * review). Every column the row has then left the API, declared or not:
 * `topicIds` and `insightVersion`, which the summaries of version 2 added
 * as the row's own bookkeeping, and `lastIndexedEventId` and
 * `lastIndexedSize`, which are the reconcile's. Written out, a column added
 * to the row stays in until somebody declares it here and in the class.
 */
export function toChatSessionDto(
  session: IChatSessionData,
  added: Pick<ChatSessionDto, 'topics' | 'person' | 'peer'>,
): ChatSessionDto {
  return {
    id: session.id,
    agentId: session.agentId,
    channel: session.channel,
    externalUserId: session.externalUserId,
    sessionKey: session.sessionKey,
    title: session.title,
    preview: session.preview,
    lastRole: session.lastRole,
    lastMessageAt: session.lastMessageAt,
    messageCount: session.messageCount,
    userMessageCount: session.userMessageCount,
    summary: session.summary,
    summaryAt: session.summaryAt,
    insights: session.insights,
    outcome: session.outcome,
    question: session.question,
    archived: session.archived,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...added,
  };
}

export class ChatListResponseDto {
  @ApiProperty({ type: [ChatSessionDto] }) items: ChatSessionDto[];
  @ApiProperty({ example: 128 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 50 }) perPage: number;
}
