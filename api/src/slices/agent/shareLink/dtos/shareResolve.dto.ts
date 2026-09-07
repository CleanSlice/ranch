import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Body of `POST /share/resolve`. The token shape is validated up front so a
 *  malformed link never reaches the database — 400, not 404. */
export class ShareResolveRequestDto {
  @ApiProperty({
    description:
      'The share token from the link (`sl_` + 43 url-safe characters).',
    pattern: '^sl_[A-Za-z0-9_-]{43}$',
    example: 'sl_mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU',
  })
  @IsString()
  @Matches(/^sl_[A-Za-z0-9_-]{43}$/)
  token: string;
}

/**
 * Everything a share visitor learns about the agent behind a link.
 * Deliberately slim: no config, no resources, no workflow (FR-014).
 */
export class ShareResolvedDto {
  @ApiProperty({
    description: 'Id of the shared agent — used for the chat requests.',
    example: 'a1b2c3d4-0000-4000-8000-000000000001',
  })
  agentId: string;

  @ApiProperty({
    description: 'Display name of the shared agent.',
    example: 'Support bot',
  })
  agentName: string;

  @ApiProperty({
    description:
      "The agent's persisted status (running | unreachable | deploying | " +
      "stopped | failed | …). 'running' means the chat is live.",
    example: 'running',
  })
  agentStatus: string;
}
