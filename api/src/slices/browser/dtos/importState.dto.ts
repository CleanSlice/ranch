import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StorageStateCookieDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(8192)
  value: string;

  @ApiProperty({ example: '.instagram.com' })
  @IsString()
  @MaxLength(255)
  domain: string;

  @ApiProperty({ example: '/' })
  @IsString()
  @MaxLength(255)
  path: string;

  // Playwright's storageState uses -1 to mean "session cookie".
  @ApiProperty({ description: 'Unix seconds, or -1 for session cookie' })
  @IsInt()
  expires: number;

  @ApiProperty()
  @IsBoolean()
  httpOnly: boolean;

  @ApiProperty()
  @IsBoolean()
  secure: boolean;

  @ApiProperty({ enum: ['Strict', 'Lax', 'None'] })
  @IsIn(['Strict', 'Lax', 'None'])
  sameSite: 'Strict' | 'Lax' | 'None';
}

export class ImportStateDto {
  @ApiProperty({
    description:
      'Profile name. Must match the value the agent will pass as `profile` to browser_play. Sanitized server-side before being used as a filename.',
    example: 'instagram:miybot',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    message:
      'profile may only contain alphanumerics, underscore, colon, dot, dash',
  })
  profile: string;

  @ApiProperty({
    type: [StorageStateCookieDto],
    description:
      'Cookies in Playwright storageState shape. Re-used 1:1 by the agent runtime when launching Chromium with { storageState: <file> }.',
  })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => StorageStateCookieDto)
  cookies: StorageStateCookieDto[];

  @ApiPropertyOptional({
    description:
      'Per-origin localStorage entries. The extension does not collect these today (would need a per-origin content script), but we accept them so future versions can fill them in without an API bump.',
  })
  @IsOptional()
  @IsArray()
  origins?: unknown[];

  @ApiPropertyOptional({
    description:
      'User-Agent string of the browser the cookies were exported from. The agent runtime applies this to its Playwright context so Instagram/Facebook/banks see the SAME browser fingerprint as the one that issued the session — a mismatch (Mac Chrome → Linux HeadlessChrome) is the main reason replayed cookies still hit the login page.',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class ImportStateResponseDto {
  @ApiProperty()
  ok: true;

  @ApiProperty({
    description:
      'Relative path under the agent S3 prefix where the storageState was saved. The runtime sees this as `<agentDir>/<path>` after the next S3 sync tick.',
    example: 'browser-state/55212224-instagram_miybot.json',
  })
  path: string;

  @ApiProperty()
  cookies: number;
}

export class IssueExtensionTokenDto {
  @ApiProperty({
    description:
      'Agent the extension token will be scoped to. The token only allows writing state files under this agent\'s S3 prefix.',
  })
  @IsString()
  @MaxLength(80)
  agentId: string;

  @ApiProperty({
    description:
      'User ID (within the agent context — typically the Telegram user ID for chat-driven agents, or "admin" for the admin agent). Used as the filename prefix so multiple humans can keep separate cookies inside one agent.',
  })
  @IsString()
  @MaxLength(80)
  userId: string;

  @ApiPropertyOptional({
    description: 'Token lifetime in days. Defaults to 30; max 365.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @IsInt()
  ttlDays?: number;
}

export class IssueExtensionTokenResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty({ description: 'Unix seconds' })
  exp: number;
}
