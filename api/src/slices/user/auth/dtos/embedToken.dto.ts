import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserRoleTypes } from '../../user/domain';

/**
 * `sub` becomes the chat client id, the transcript channel and part of the
 * session file name on the runtime, so it is a plain identifier: letters,
 * digits, dash and underscore. `admin` is the owners' conversation; `anon-`,
 * `share-` and `http-` are the namespaces the hub mints itself (CLEAN-175).
 */
const EMBED_SUB_PATTERN = /^(?!admin$)(?!anon-)(?!share-)(?!http-)[A-Za-z0-9_-]{1,128}$/;

export class EmbedTokenDto {
  @ApiProperty({
    description:
      'Subject — the visitor identity: used as clientId and transcript channel inside the bridle hub. Letters, digits, dash and underscore, 1-128 characters; never `admin`, never prefixed `anon-`, `share-` or `http-`, never an existing user id.',
    example: 'wslid-A1234567',
    pattern: EMBED_SUB_PATTERN.source,
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  @Matches(EMBED_SUB_PATTERN, {
    message:
      'sub: letters, digits, dash and underscore only, 1-128 characters, not admin and not prefixed anon-, share- or http-',
  })
  sub: string;

  @ApiPropertyOptional({ example: 'alice@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Server filters Owner/Admin out unless the presenting API key carries the embed:mint-admin scope; plain embed keys cannot grant platform-admin to a visitor.',
    isArray: true,
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(UserRoleTypes, { each: true })
  roles?: UserRoleTypes[];

  @ApiPropertyOptional({
    description: 'Duration string (s/m/h/d). Defaults to 15m.',
    example: '15m',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+[smhd]$/)
  expiresIn?: string;
}
