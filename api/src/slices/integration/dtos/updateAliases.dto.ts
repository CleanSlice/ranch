import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateIntegrationAliasesDto {
  @ApiProperty({
    type: [String],
    description:
      'Full replacement list of runtime identities. Pass the desired final state — diff is computed server-side, with cookies/secrets mirrored to newly added aliases and wiped from removed ones. Pass [] to clear all aliases.',
    example: ['55212224', 'admin'],
  })
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    each: true,
    message:
      'each alias may only contain alphanumerics, underscore, colon, dot, dash',
  })
  aliases: string[];
}
