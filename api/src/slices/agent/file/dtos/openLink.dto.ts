import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Body of `POST /agents/:id/files/open-link` (CLEAN-112). */
export class OpenLinkBodyDto {
  @ApiProperty({ example: 'workspace/log.txt' })
  @IsString()
  path!: string;
}

export class OpenLinkDto {
  @ApiProperty({
    description:
      'Address of the raw stored file. Absolute when PUBLIC_API_URL is configured, otherwise a path the console prefixes with its API base.',
    example: '/agents/agent-1/files/raw?token=eyJ…',
  })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
