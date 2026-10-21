import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  BOT_TOKEN_MAX_LENGTH,
  BOT_TOKEN_PATTERN,
  CHANNEL_ID_PATTERN,
  DESTINATION_KINDS,
  DestinationKindTypes,
} from '../domain/agentEvent.types';

/**
 * One body, two shapes: `kind` says which fields matter. The service checks
 * the secret's shape once more and nulls the other kind's secret.
 */
export class SaveNotificationDestinationDto {
  @ApiProperty({
    enum: DESTINATION_KINDS,
    description:
      '`webhook`: a Slack incoming webhook — one message when an incident opens, one when it closes. `bot`: a Slack bot token and a channel — one message per incident, its story in the thread, the state as a reaction.',
  })
  @IsIn(DESTINATION_KINDS)
  kind: DestinationKindTypes;

  @ApiPropertyOptional({
    description:
      'kind = webhook: the incoming-webhook address (https://hooks.slack.com/services/…). A secret: stored and never returned.',
  })
  @ValidateIf((o: SaveNotificationDestinationDto) => o.kind === 'webhook')
  @IsString()
  @IsNotEmpty({ message: 'webhookUrl is required for the webhook kind' })
  @MaxLength(500)
  webhookUrl?: string;

  @ApiPropertyOptional({
    description:
      'kind = bot: the Bot User OAuth Token (xoxb-…) from OAuth & Permissions. A secret: stored and never returned.',
  })
  @ValidateIf((o: SaveNotificationDestinationDto) => o.kind === 'bot')
  @IsString()
  @IsNotEmpty({ message: 'botToken is required for the bot kind' })
  @MaxLength(BOT_TOKEN_MAX_LENGTH)
  @Matches(BOT_TOKEN_PATTERN, {
    message:
      'A bot token (xoxb-…) is needed — OAuth & Permissions → Bot User OAuth Token — not a user token',
  })
  botToken?: string;

  @ApiPropertyOptional({
    description:
      'kind = bot: the channel id (C0…), from the channel’s About tab. Not a secret.',
  })
  @ValidateIf((o: SaveNotificationDestinationDto) => o.kind === 'bot')
  @IsString()
  @IsNotEmpty({ message: 'channelId is required for the bot kind' })
  @Matches(CHANNEL_ID_PATTERN, {
    message:
      'The channel id must look like C0… (channel → About → Channel ID), not the channel name',
  })
  channelId?: string;
}

export class NotificationLastDeliveryDto {
  @ApiProperty()
  at: Date;

  @ApiProperty()
  ok: boolean;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}

/** What may be seen of the destination. No secret is part of it. */
export class NotificationDestinationDto {
  @ApiProperty()
  configured: boolean;

  @ApiProperty({ nullable: true, enum: DESTINATION_KINDS })
  kind: DestinationKindTypes | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The last four characters of the secret that is set (the webhook address or the bot token).',
  })
  hint: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The bot’s channel id; null on the webhook kind.',
  })
  channelId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The installation’s label at the start of every message ([dev], [prod-eu]): the infrastructure.environment setting, else RANCH_ENVIRONMENT on the API; null when neither is set.',
  })
  environment: string | null;

  @ApiProperty({
    description:
      'Copies of the API alive right now. More than one means agents are seen by only one of them: unreachable detection is paused and chats may miss the agent’s socket. Run ranch-api as one replica.',
    example: 1,
  })
  apiReplicas: number;

  @ApiProperty({ nullable: true, type: String })
  updatedBy: string | null;

  @ApiProperty({ nullable: true, type: Date })
  updatedAt: Date | null;

  @ApiProperty({
    description:
      'false when ADMIN_URL is not set on the API: messages then carry no link to the console.',
  })
  consoleLinks: boolean;

  @ApiProperty({ nullable: true, type: NotificationLastDeliveryDto })
  lastDelivery: NotificationLastDeliveryDto | null;
}

export class TestDeliveryDto {
  @ApiProperty()
  delivered: boolean;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}
