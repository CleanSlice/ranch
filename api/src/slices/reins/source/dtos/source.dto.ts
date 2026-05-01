import { ApiProperty } from '@nestjs/swagger';
import { ISourceData, SourceTypes } from '../domain/source.types';

export class SourceDto implements ISourceData {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['file', 'url', 'text'] }) type: SourceTypes;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) mimeType: string | null;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null;
  @ApiProperty() indexed: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
