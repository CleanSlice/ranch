import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Open a peer connection to visitors, or close it (CLEAN-236).
 *
 * Opening publishes the peer to everybody who can talk to the agent, so it is
 * the one of the two that asks for `confirm`.
 */
export class PeerVisitorsDto {
  @ApiProperty({
    description:
      'True: the peer serves everybody who talks to the agent, people with ' +
      'no access to the peer and visitors included. False: only the people ' +
      'who have access to the peer.',
    example: true,
  })
  @IsBoolean()
  open: boolean;

  @ApiPropertyOptional({
    description: 'Required, and true, when `open` is true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
