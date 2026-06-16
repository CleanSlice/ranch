import { ApiProperty } from '@nestjs/swagger';

export class AddFromArchiveResultDto {
  @ApiProperty({
    example: 288,
    description:
      'Number of ingestable files detected in the archive. Import runs in the background; refresh the sources list to watch them appear.',
  })
  detected: number;

  @ApiProperty({ example: true })
  started: boolean;
}
