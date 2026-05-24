import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
}
