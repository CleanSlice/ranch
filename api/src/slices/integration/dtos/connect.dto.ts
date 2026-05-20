import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ConnectIntegrationDto {
  @ApiProperty({
    example: 'instagram',
    description: 'Catalogue key (see GET /integrations/catalogue).',
  })
  @IsString()
  @MaxLength(40)
  service: string;

  @ApiProperty({
    example: 'miybot',
    description:
      'User-chosen label for this account. Becomes part of BrowserSession.accountKey for browser-mechanism services. Same charset rules as browser sessions.',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, dot, dash',
  })
  accountKey: string;

  @ApiPropertyOptional({
    description: 'Human-friendly label shown in the admin UI list.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional alternate runtime identities this account should be available under. Typically Telegram chat IDs or "admin". Up to 16, each ≤80 chars, alphanumerics + underscore/colon/dot/dash only. The service fans out cookie/secret writes to all of them. Can also be edited later via PATCH /accounts/:id/aliases.',
    example: ['55212224', 'admin'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    each: true,
    message:
      'each alias may only contain alphanumerics, underscore, colon, dot, dash',
  })
  aliases?: string[];
}
