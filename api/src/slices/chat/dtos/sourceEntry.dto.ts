import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ChatSourceKinds, IChatSourceEntry } from '../domain';

/**
 * A source an answer drew on, as a reader sees it (CLEAN-138). Addressed by
 * the message id and `n`; the Source id, knowledge id and storage location
 * never leave the API. Carried by the live `sources` frame and by every
 * history route, so one component renders both.
 */
export class SourceEntryDto implements IChatSourceEntry {
  @ApiProperty({
    example: 1,
    description: 'Citation number inside the message, 1-based and dense.',
  })
  n: number;

  @ApiProperty({ enum: ['knowledge', 'web'] })
  kind: ChatSourceKinds;

  @ApiProperty({
    example: 'Contract 2025.pdf',
    description:
      'The knowledge source name, or the page title (its readable address when the page had none). Shown as received.',
  })
  name: string;

  @ApiPropertyOptional({
    example: 'https://example.com/page',
    description: 'Web sources only. Always http(s).',
  })
  url?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Knowledge sources only: the base the document belongs to.',
  })
  knowledgeName?: string | null;

  @ApiProperty({
    description:
      'Knowledge: the base allows readers to open documents (or the reader is on the platform team) and the source still exists. Web: the address is a web address. Computed when served, never stored.',
  })
  canOpen: boolean;

  @ApiPropertyOptional({
    enum: [1, -1],
    description: 'Knowledge sources only: the reader’s own current rating.',
  })
  myRating?: 1 | -1;
}
