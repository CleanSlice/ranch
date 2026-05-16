import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrowserSessionStatusTypes } from '../domain';

export class BrowserSessionDto {
  @ApiProperty({ example: 'browser-7b8c2e22-...' })
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 'instagram:miybot' })
  accountKey: string;

  @ApiProperty({ enum: BrowserSessionStatusTypes })
  status: BrowserSessionStatusTypes;

  @ApiProperty()
  lastUsedAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class BrowserSessionConnectionDto {
  @ApiProperty({ type: BrowserSessionDto })
  session: BrowserSessionDto;

  @ApiProperty({
    description:
      'CDP WebSocket URL. Carries a single-use launch payload and the pool token — never expose to UI, only to authenticated runtime calls.',
  })
  cdpUrl: string;

  @ApiPropertyOptional({
    description:
      'Live VNC URL (signed JWT, 15 min TTL). Send to the end user when they need to finish a 2FA/CAPTCHA flow manually.',
    nullable: true,
  })
  vncUrl: string | null;
}
