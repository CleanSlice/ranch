import { ApiProperty } from '@nestjs/swagger';
import { IArchiveImportResult } from '../domain/source.types';

export class AddFromArchiveResultDto implements IArchiveImportResult {
  @ApiProperty({
    example: 288,
    description:
      'Number of ingestable files detected in the archive. Import runs in the background; poll GET .../sources/imports for progress.',
  })
  detected: number;

  @ApiProperty({ example: true })
  started: boolean;

  @ApiProperty({
    description:
      'Id of the background import job (see GET .../sources/imports)',
  })
  jobId: string;
}
