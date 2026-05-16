import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class OpenSessionDto {
  @ApiProperty({
    description:
      'Account identifier scoped to the calling user, e.g. "instagram:miybot" or "paypal:main". Must match /^[a-zA-Z0-9_:\\-]+$/ — anything else is rejected before it can touch the profile filesystem path.',
    example: 'instagram:miybot',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:\-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, and dash',
  })
  accountKey: string;
}
