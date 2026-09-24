import { ApiProperty } from '@nestjs/swagger';

export class FileChunkDto {
  @ApiProperty({ example: 'data/sessions/bridle:admin.jsonl' })
  path!: string;

  @ApiProperty({
    description:
      'UTF-8 slice of the file from `offset`. Never ends in the middle of a character.',
  })
  content!: string;

  @ApiProperty({ example: 262144, description: 'Byte length of `content`.' })
  size!: number;

  @ApiProperty({
    example: 393216,
    description: 'Full byte length of the file.',
  })
  totalSize!: number;

  @ApiProperty({
    example: 0,
    description: 'Byte offset of the first byte of `content`.',
  })
  offset!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 262144,
    description:
      'Pass as `offset` on the next request. `null` when there is no more data.',
  })
  nextOffset!: number | null;

  @ApiProperty({ example: true })
  hasMore!: boolean;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ enum: ['text', 'binary'] })
  kind!: 'text' | 'binary';

  @ApiProperty({
    description:
      'Whole file is text and within the editable size limit. Editing also needs `hasMore === false`.',
  })
  editable!: boolean;
}
