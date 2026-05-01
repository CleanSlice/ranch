import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRoleTypes } from '../domain';

export class CreateUserDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'strongPassword1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
    example: [UserRoleTypes.User],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(UserRoleTypes, { each: true })
  roles?: UserRoleTypes[];
}
