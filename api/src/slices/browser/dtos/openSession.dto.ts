import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export class OpenSessionDto {
  @ApiProperty({
    description:
      'Account identifier scoped to the calling user, e.g. "instagram:miybot" or "paypal:main". Must match /^[a-zA-Z0-9_:\\-]+$/ — anything else is rejected before it can touch the profile filesystem path.',
    example: 'instagram:miybot',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, and dash',
  })
  accountKey: string;

  @ApiPropertyOptional({
    description:
      'Page to navigate to in the pre-warmed Chrome. Drives what the VNC viewer renders when the user opens the returned vncUrl — set this to the service\'s login page (e.g. "https://www.instagram.com/accounts/login/"). Defaults to about:blank if omitted; the user can still type a URL in the address bar.',
    example: 'https://www.instagram.com/accounts/login/',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  loginUrl?: string;
}
