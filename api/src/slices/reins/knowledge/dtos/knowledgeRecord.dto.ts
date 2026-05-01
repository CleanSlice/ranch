import { ApiProperty } from '@nestjs/swagger';
import {
  IKnowledgeQueryReference,
  IKnowledgeQueryResult,
} from '../domain/reins.types';

export class KnowledgeQueryReferenceDto implements IKnowledgeQueryReference {
  @ApiProperty() referenceId: string;
  @ApiProperty() filePath: string;
}

export class KnowledgeQueryResultDto implements IKnowledgeQueryResult {
  @ApiProperty() answer: string;

  @ApiProperty({ type: [KnowledgeQueryReferenceDto] })
  references: KnowledgeQueryReferenceDto[];
}
