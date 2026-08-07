import { ApiProperty } from '@nestjs/swagger';

export class AddFilesResultDto {
  @ApiProperty({ example: 8, description: 'Files uploaded and registered.' })
  added: number;

  @ApiProperty({
    example: 2,
    description:
      'Files skipped because a file source with the same name already exists on this knowledge.',
  })
  skipped: number;

  @ApiProperty({ example: 1, description: 'Files that failed to upload.' })
  failed: number;

  @ApiProperty({
    type: [String],
    example: ['broken.pdf: S3 upload failed'],
    description: 'One line per failed file.',
  })
  errors: string[];
}
