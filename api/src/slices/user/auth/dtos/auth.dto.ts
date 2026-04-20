import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../user/dtos';

export class AuthDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
