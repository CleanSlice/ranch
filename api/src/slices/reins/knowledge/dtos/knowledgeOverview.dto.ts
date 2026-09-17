import { ApiProperty } from '@nestjs/swagger';
import { IKnowledgeOverview } from '../domain/knowledge.types';

export class SourceTypeCountsDto {
  @ApiProperty() file: number;
  @ApiProperty() url: number;
  @ApiProperty() text: number;
}

export class KnowledgeOverviewDto implements IKnowledgeOverview {
  @ApiProperty({ description: 'Sources attached to this knowledge' })
  sourceCount: number;
  @ApiProperty({ description: 'Sources LightRAG confirmed as processed' })
  indexedCount: number;
  @ApiProperty({ description: 'Failed, and nothing will retry them by itself' })
  failedCount: number;
  @ApiProperty({ description: 'Failed for a passing reason; retried automatically' })
  retryingCount: number;
  @ApiProperty({ description: 'Handed to LightRAG and still in its pipeline' })
  processingCount: number;
  @ApiProperty({ type: SourceTypeCountsDto }) byType: SourceTypeCountsDto;
  @ApiProperty({ description: 'Sum of the stored files, in bytes' })
  totalSizeBytes: number;
}
