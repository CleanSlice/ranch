import { ApiProperty } from '@nestjs/swagger';
import {
  ISourceData,
  SourceIndexStatusTypes,
  SourceIndexStateTypes,
  SourceTextStateTypes,
  SourceTypes,
} from '../domain/source.types';

export const SOURCE_INDEX_STATUSES: readonly SourceIndexStatusTypes[] = [
  'indexed',
  'pending',
  'failed',
];

export class SourceDto implements Omit<ISourceData, 'textUrl'> {
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
  @ApiProperty({
    enum: ['none', 'pending', 'ready', 'failed'],
    description:
      'Text extraction for a PDF without a text layer: none (not a PDF, or it has its own text), pending (probing or OCR running), ready (recognised text is what gets indexed), failed (see textError).',
  })
  textState: SourceTextStateTypes;
  @ApiProperty({ type: String, nullable: true }) textError: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
