import { ApiProperty } from '@nestjs/swagger';

export class DeleteFilesDto {
  @ApiProperty({
    example: 3,
    description: 'Number of S3 objects deleted by this request.',
  })
  deleted!: number;
}
