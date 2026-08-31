import { ApiProperty } from '@nestjs/swagger';
import {
  IKnowledgeData,
  IndexStatusTypes,
  InstanceStateTypes,
  MigrationStateTypes,
} from '../domain/knowledge.types';

// `workspace` and `instanceEndpoint` stay off the wire on purpose: the first
// is the retrieval service's internal namespace name (the product surface
// avoids the word), the second is an in-cluster address no console needs.
export class KnowledgeDto implements Omit<
  IKnowledgeData,
  'workspace' | 'instanceEndpoint'
> {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({
    enum: ['idle', 'indexing', 'ready', 'failed', 'empty', 'partial'],
    description:
      'Derived from the sources: empty (nothing added), indexing (a source is being processed), partial (some sources are not searchable), ready (every source answers).',
  })
  indexStatus: IndexStatusTypes;
  @ApiProperty({ type: String, nullable: true }) indexError: string | null;
  @ApiProperty({ type: String, nullable: true }) indexedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) indexStartedAt: Date | null;
  @ApiProperty({ enum: ['absent', 'starting', 'ready', 'failed', 'stopping'] })
  instanceState: InstanceStateTypes;
  @ApiProperty({ type: String, nullable: true }) instanceError: string | null;
  @ApiProperty({ enum: ['notStarted', 'inProgress', 'done', 'failed'] })
  migrationState: MigrationStateTypes;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class KnowledgeListItemDto extends KnowledgeDto {
  @ApiProperty() sourcesCount: number;
  @ApiProperty() totalSizeBytes: number;
}

export class KnowledgePageDto {
  @ApiProperty({ type: [KnowledgeListItemDto] })
  items: KnowledgeListItemDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}
