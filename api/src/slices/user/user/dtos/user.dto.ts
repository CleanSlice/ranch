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
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
    example: UserRoleTypes.User,
  })
  role: UserRoleTypes;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
