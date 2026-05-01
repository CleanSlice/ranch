import { ApiProperty } from '@nestjs/swagger';
import { UserRoleTypes } from '../domain';

export class UserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({
    isArray: true,
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
    example: [UserRoleTypes.User],
  })
  roles: UserRoleTypes[];

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
