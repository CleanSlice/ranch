import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IKnowledgeQueryReference,
  IKnowledgeQueryResult,
} from '../domain/knowledge.types';

export class KnowledgeQueryReferenceDto implements IKnowledgeQueryReference {
  @ApiProperty() referenceId: string;
  @ApiProperty() filePath: string;
  @ApiProperty({ type: String, nullable: true }) sourceId: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceName: string | null;
}

export class KnowledgeQueryResultDto implements IKnowledgeQueryResult {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'null when the base holds nothing relevant — see reason. Never a generated answer assembled from another base.',
  })
  answer: string | null;

  @ApiPropertyOptional({
    enum: ['no_relevant_content', 'partial_refusal'],
    description:
      'no_relevant_content: the base holds nothing relevant. partial_refusal: the retrieval model declined in its own words; the documents may still hold it.',
  })
  reason?: 'no_relevant_content' | 'partial_refusal';

  @ApiProperty() knowledgeId: string;

  @ApiProperty({
    description:
      'false while this base is still being re-processed into its own area — answers may be incomplete.',
  })
  complete: boolean;

  @ApiProperty({ type: [KnowledgeQueryReferenceDto] })
  references: KnowledgeQueryReferenceDto[];
}
