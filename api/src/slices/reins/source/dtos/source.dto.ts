import { ApiProperty } from '@nestjs/swagger';
import {
  ISourceData,
  SourceIndexStateTypes,
  SourceTypes,
} from '../domain/source.types';

export class SourceDto implements ISourceData {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['file', 'url', 'text'] }) type: SourceTypes;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) mimeType: string | null;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null;
  // The old `indexed` boolean meant "handed over", not "searchable" —
  // keeping a truthful state next to a misleading boolean is how the
  // misleading one survives, so it is gone rather than deprecated.
  @ApiProperty({ enum: ['queued', 'processing', 'indexed', 'failed'] })
  indexState: SourceIndexStateTypes;
  @ApiProperty({ type: String, nullable: true }) indexError: string | null;
  @ApiProperty({ type: String, nullable: true }) indexedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
