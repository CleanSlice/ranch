import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../user/dtos';

export class AuthDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({
    description:
      'Access-token lifetime in seconds at issue time. Renew via POST /auth/refresh before it runs out; the session cookie set alongside is what the refresh needs.',
  })
  expiresIn: number;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
