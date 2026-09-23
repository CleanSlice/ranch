import { ApiProperty } from '@nestjs/swagger';

export class FileNodeDto {
  @ApiProperty({ example: 'memory/MEMORY.md' })
  path!: string;

  @ApiProperty({ example: 3712 })
  size!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    enum: ['text', 'binary'],
    description:
      'Decided by the API: known extension, or a sniff of the first bytes for unknown ones.',
  })
  kind!: 'text' | 'binary';

  @ApiProperty({
    description: 'Text and within the editable size limit (see /files/limits).',
  })
  editable!: boolean;
}
