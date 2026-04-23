import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IKnowledgeQueryRecord } from '../domain/reins.types';

class KnowledgeRecordMetadataDto {
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() source?: string;
  @ApiPropertyOptional() sourceId?: string;
}

export class KnowledgeRecordDto implements IKnowledgeQueryRecord {
  @ApiProperty() pageContent: string;
  @ApiProperty({ type: KnowledgeRecordMetadataDto })
  metadata: KnowledgeRecordMetadataDto;
}
