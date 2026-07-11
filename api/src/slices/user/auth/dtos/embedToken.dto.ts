import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { UserRoleTypes } from '../../user/domain';

export class EmbedTokenDto {
  @ApiProperty({
    description:
      'Subject — used as clientId for routing inside the bridle hub.',
    example: 'user-123',
  })
  @IsString()
  @MinLength(1)
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
