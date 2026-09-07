import { ApiProperty } from '@nestjs/swagger';

/**
 * Owner-facing view of an agent's share link (CLEAN-66). Response-only — the
 * owner routes take no body, so nothing here needs class-validator.
 *
 * The API never builds the shareable URL; the console renders
 * `${location.origin}/share?token=${token}`.
 */
export class ShareLinkDto {
  @ApiProperty({
    description:
      'True while the link accepts visitors. False when the agent was never ' +
      'shared or the link has been revoked.',
    example: true,
  })
  active: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The share secret. Exposed only while the link is active — a revoked ' +
      'token is dead and is never handed back, so this is null whenever ' +
      'active is false.',
    example: 'sl_mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU',
  })
  token: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the link row was first created; null if never shared.',
    example: '2026-09-07T10:00:00.000Z',
  })
  createdAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the link was revoked; null while it is active.',
    example: null,
  })
  revokedAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the token was last replaced; null until the first regenerate.',
    example: null,
  })
  rotatedAt: string | null;

  @ApiProperty({
    description: 'How many times the token has been replaced.',
    example: 0,
  })
  rotationCount: number;
}
