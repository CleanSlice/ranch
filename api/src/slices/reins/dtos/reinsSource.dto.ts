import { ApiProperty } from '@nestjs/swagger';
import { IReinsSourceData, SourceTypes } from '../domain/reins.types';

export class ReinsSourceDto implements IReinsSourceData {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['file', 'url', 'text'] }) type: SourceTypes;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) mimeType: string | null;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null;
  @ApiProperty({ type: String, nullable: true }) lightragDocId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
