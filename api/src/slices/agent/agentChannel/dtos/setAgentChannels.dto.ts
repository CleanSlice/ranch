import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class TelegramChannelConfigDto {
  @ApiProperty({
    description: 'Telegram bot HTTP API token (issued by @BotFather).',
  })
  @IsString()
  botToken: string;

  @ApiPropertyOptional({
    description: 'Public bot username without @ — shown on landing pages.',
  })
  @IsOptional()
  @IsString()
  botName?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated Telegram chat IDs treated as bot admins by the runtime.',
  })
  @IsOptional()
  @IsString()
  adminIds?: string;
}

export class AgentChannelDto {
  @ApiProperty({
    enum: ['telegram'],
    description:
      'Channel type. Discriminator — config shape depends on this. v1 only telegram.',
  })
  @IsString()
  @IsIn(['telegram'])
  type: 'telegram';

  @ApiProperty({ type: TelegramChannelConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TelegramChannelConfigDto)
  config: TelegramChannelConfigDto;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Live state reported by the runtime (data/channels/status.json). ' +
      'true = polling/connected, false = last start attempt failed (see ' +
      'statusReason), null = unknown (no status reported yet). Read-only — ' +
      'ignored on PUT.',
  })
  @IsOptional()
  @IsBoolean()
  connected?: boolean | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Failure reason when connected=false (e.g. an invalid token). Read-only.',
  })
  @IsOptional()
  @IsString()
  statusReason?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Unix ms of the last status change. Read-only.',
  })
  @IsOptional()
  @IsNumber()
  statusUpdatedAt?: number | null;
}

export class SetAgentChannelsDto {
  @ApiProperty({
    type: [AgentChannelDto],
    description:
      'Replace the full set of channels. Pass [] to clear all channels.',
  })
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AgentChannelDto)
  channels: AgentChannelDto[];
}
