import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatalogueItemDto {
  @ApiProperty({
    example: 'instagram',
    description: 'Stable service key. Use this in POST /integrations/accounts.',
  })
  service: string;

  @ApiProperty({ example: 'Instagram' })
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ example: '/icons/integrations/instagram.svg' })
  iconUrl: string;

  @ApiProperty({ enum: ['browser', 'secret'] })
  mechanism: 'browser' | 'secret';

  @ApiPropertyOptional({
    description:
      'Browser-mechanism: URL the pool Chrome navigates to before the user opens the VNC view.',
  })
  loginUrl?: string;

  @ApiPropertyOptional({
    description:
      'Browser-mechanism: hint text the UI shows under the accountKey input.',
  })
  accountKeyHint?: string;

  @ApiPropertyOptional({
    description:
      'Browser-mechanism: domains the Chrome extension auto-matches the current tab against (suffix match).',
    type: [String],
  })
  domains?: string[];

  @ApiPropertyOptional({
    description:
      'Secret-mechanism: env var name the runtime exposes to agents.',
  })
  secretEnvKey?: string;

  @ApiPropertyOptional({
    description:
      'Secret-mechanism: short help string the UI shows under the secret input.',
  })
  secretHelp?: string;
}
