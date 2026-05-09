import { ApiProperty } from '@nestjs/swagger';

export class EmbedTokenResultDto {
  @ApiProperty({
    description: 'Signed JWT for the bridle widget data-token attribute.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token: string;

  @ApiProperty({ description: 'Token expiry as ISO date string.' })
  expiresAt: Date;
}
