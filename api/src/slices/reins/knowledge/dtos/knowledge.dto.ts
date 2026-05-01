import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IKnowledgeData, IndexStatusTypes } from '../domain/reins.types';
import { SourceDto } from '../../source/dtos/source.dto';

export class KnowledgeDto implements IKnowledgeData {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: [String] }) entityTypes: string[];
  @ApiProperty({ type: [String] }) relationshipTypes: string[];
  @ApiProperty({ enum: ['idle', 'indexing', 'ready', 'failed'] })
  indexStatus: IndexStatusTypes;
  @ApiProperty({ type: String, nullable: true }) indexError: string | null;
  @ApiProperty({ type: String, nullable: true }) indexedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) indexStartedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [SourceDto] }) sources?: SourceDto[];
}
