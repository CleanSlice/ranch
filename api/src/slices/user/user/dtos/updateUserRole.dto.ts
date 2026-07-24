import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ASSIGNABLE_USER_ROLES, UserRoleTypes } from '../domain';

export class UpdateUserRoleDto {
  // Owner is deliberately not assignable — it exists once, created via /init.
  @ApiProperty({
    enum: ASSIGNABLE_USER_ROLES,
    enumName: 'AssignableUserRoleTypes',
    example: UserRoleTypes.User,
  })
  @IsIn(ASSIGNABLE_USER_ROLES)
  role: UserRoleTypes;
}
