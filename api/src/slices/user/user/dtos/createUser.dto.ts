import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ASSIGNABLE_USER_ROLES, UserRoleTypes } from '../domain';

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

  // Owner is deliberately not assignable — it exists once, created via /init.
  @ApiPropertyOptional({
    enum: ASSIGNABLE_USER_ROLES,
    enumName: 'AssignableUserRoleTypes',
    example: UserRoleTypes.User,
  })
  @IsOptional()
  @IsIn(ASSIGNABLE_USER_ROLES)
  role?: UserRoleTypes;
}
