import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** A card is a small document — the cap is generous and still bounded. */
const MAX_CARD_BODY = 256_000;

/**
 * One-of body (CLEAN-95, CLEAN-116): pick an agent of this installation by
 * id, import an external A2A agent by its address, or hand over its card
 * directly. Exactly one of the three must be given; the controller enforces
 * the exclusivity so the error can carry `PEER_BODY` instead of a generic
 * validation message.
 */
export class ConnectPeerDto {
  @ApiPropertyOptional({
    description:
      'An agent of this installation to connect. Format: `agent-<uuid>`. ' +
      'Mutually exclusive with `url`.',
    example: 'agent-3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  })
  @IsOptional()
  @Matches(
    /^agent-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  )
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
      'The agent card itself, as JSON or YAML, for an agent whose card is ' +
      'not published at an address (CLEAN-116). Vetted exactly like an ' +
      'imported address, and identified by the address the card names, so ' +
      'importing the same agent later by URL updates this entry rather than ' +
      'duplicating it. Mutually exclusive with `peerAgentId` and `url`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CARD_BODY)
  card?: string;

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
  @ApiPropertyOptional({
    description:
      'A2A address of the agent to preview — base URL or its well-known ' +
      'card form. Mutually exclusive with `card`.',
    example: 'https://other.example/a2a/agents/agent-1a2b…',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({
    description:
      'The card itself, as JSON or YAML, when it is not published anywhere ' +
      '(CLEAN-116). Read and checked, never saved. Mutually exclusive with ' +
      '`url`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CARD_BODY)
  card?: string;

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
