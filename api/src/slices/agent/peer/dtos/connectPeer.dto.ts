import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * One-of body (CLEAN-95): pick an agent of this installation by id, or import
 * an external A2A agent by its address. Exactly one of the two must be given;
 * the controller enforces the exclusivity so the error can carry `PEER_BODY`
 * instead of a generic validation message.
 */
export class ConnectPeerDto {
  @ApiPropertyOptional({
    description:
      'An agent of this installation to connect. Format: `agent-<uuid>`. ' +
      'Mutually exclusive with `url`.',
    example: 'agent-3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  })
  @IsOptional()
  @Matches(/^agent-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  peerAgentId?: string;

  @ApiPropertyOptional({
    description:
      'A2A address of an agent outside this installation — the agent base ' +
      'URL or its `…/.well-known/agent-card.json` form. Importing an address ' +
      'that is already connected updates that entry in place. Mutually ' +
      'exclusive with `peerAgentId`.',
    example: 'https://other.example/a2a/agents/agent-1a2b…',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({
    description:
      'Bearer credential the external agent expects, when it needs one. ' +
      'Stored write-only — no response ever returns it. On re-import: ' +
      'omitted keeps the stored credential, empty string clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  token?: string;
}

/** Read an external agent's card without saving anything — the preview an
 *  operator reviews before Connect (CLEAN-95, FR-002). */
export class PreviewPeerUrlDto {
  @ApiProperty({
    description:
      'A2A address of the agent to preview — base URL or its well-known ' +
      'card form.',
    example: 'https://other.example/a2a/agents/agent-1a2b…',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url: string;

  @ApiPropertyOptional({
    description:
      'Bearer credential for the card read, when the agent needs one. Used ' +
      'for this read only; nothing is stored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  token?: string;
}
