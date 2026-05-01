import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { UserRoleTypes } from '../domain';

export class UpdateUserRolesDto {
  @ApiProperty({
    isArray: true,
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
    example: [UserRoleTypes.User],
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(UserRoleTypes, { each: true })
  roles: UserRoleTypes[];
}
