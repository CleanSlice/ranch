import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IntegrationAccountDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 'instagram' })
  service: string;

  @ApiProperty({
    example: 'miybot',
    description:
      'Account label scoped to (userId, service). For browser-mechanism this is also the BrowserSession.accountKey suffix.',
  })
  accountKey: string;

  @ApiProperty({ enum: ['browser', 'secret'] })
  mechanism: 'browser' | 'secret';

  @ApiPropertyOptional()
  label: string | null;

  @ApiProperty({
    enum: ['pending', 'connected', 'needs_login', 'revoked'],
    description:
      'pending: row exists but underlying credential not yet stored. connected: credential ready. needs_login: cookies expired or session lost. revoked: user disconnected.',
  })
  status: string;

  @ApiProperty({
    type: [String],
    description:
      'Alternate runtime identities this account is available under (Telegram chat IDs, "admin", channel-specific IDs). The admin UI authenticates as a ranch-user UUID, but the runtime resolves resources by ctx.from — aliases bridge that gap. On every cookie/secret write the service fans the same payload out to userId + every alias path.',
    example: ['55212224', 'admin'],
  })
  aliases: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
