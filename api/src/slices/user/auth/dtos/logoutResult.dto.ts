import { ApiProperty } from '@nestjs/swagger';

export class LogoutResultDto {
  @ApiProperty({
    description:
      'True when a live session matched the cookie and was revoked; false when there was nothing to revoke. The cookie is cleared either way.',
  })
  revoked: boolean;
}
