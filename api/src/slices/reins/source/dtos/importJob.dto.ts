import { ApiProperty } from '@nestjs/swagger';
import { IImportJob, ImportJobStatusTypes } from '../domain/source.types';

export class ImportJobDto implements IImportJob {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['archive'] }) kind: 'archive';
  @ApiProperty({ enum: ['running', 'done', 'failed'] })
  status: ImportJobStatusTypes;
  @ApiProperty({ description: 'Ingestable entries found up front' })
  detected: number;
  @ApiProperty() added: number;
  @ApiProperty({
    description: 'Entries skipped because a source with that name exists',
  })
  skipped: number;
  @ApiProperty() failed: number;
  @ApiProperty({
    type: [String],
    description: 'First failures as "<name>: <reason>", capped',
  })
  errors: string[];
  @ApiProperty() startedAt: Date;
  @ApiProperty({ type: String, nullable: true }) finishedAt: Date | null;
}
