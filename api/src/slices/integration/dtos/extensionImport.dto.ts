import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { ImportCookiesDto } from './importCookies.dto';

/**
 * Body the Ranch Chrome extension POSTs to /integrations/extension/import-state.
 * Extends ImportCookiesDto with the (service, accountKey) that picks /
 * creates the IntegrationAccount — the controller upserts the row so the
 * extension never has to call /accounts manually before the import.
 */
export class ExtensionImportStateDto extends ImportCookiesDto {
  @ApiProperty({
    example: 'instagram',
    description:
      'Catalogue service key (auto-detected by the extension from the current tab URL via catalogue.domains).',
  })
  @IsString()
  @MaxLength(40)
  service: string;

  @ApiProperty({
    example: 'miybot',
    description:
      'User-chosen accountKey for this integration. Same charset as POST /integrations/accounts.',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, dot, dash',
  })
  accountKey: string;
}

export class ExtensionImportStateResponseDto {
  @ApiProperty()
  ok: true;

  @ApiProperty({ description: 'IntegrationAccount id (created or reused).' })
  accountId: string;

  @ApiProperty()
  service: string;

  @ApiProperty()
  accountKey: string;

  @ApiProperty()
  cookies: number;
}
