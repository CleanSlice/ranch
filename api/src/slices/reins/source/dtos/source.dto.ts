import { ApiProperty } from '@nestjs/swagger';
import {
  ISourceData,
  SourceIndexStatusTypes,
  SourceIndexStateTypes,
  SourceTypes,
} from '../domain/source.types';

export const SOURCE_INDEX_STATUSES: readonly SourceIndexStatusTypes[] = [
  'indexed',
  'pending',
  'failed',
];

export class SourceDto implements ISourceData {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['file', 'url', 'text'] }) type: SourceTypes;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) mimeType: string | null;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null;
  @ApiProperty({
    description: 'True when indexStatus is "indexed". Kept for older callers.',
  })
  indexed: boolean;
  @ApiProperty({ enum: SOURCE_INDEX_STATUSES })
  indexStatus: SourceIndexStatusTypes;
  @ApiProperty({ enum: ['queued', 'processing', 'indexed', 'failed'] })
  indexState: SourceIndexStateTypes;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Error from the last index run, null once the source indexes.',
  })
  indexError: string | null;
  @ApiProperty({ type: String, nullable: true }) indexedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
