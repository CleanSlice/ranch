import { ApiProperty } from '@nestjs/swagger';

export class FileNodeDto {
  @ApiProperty({ example: 'memory/MEMORY.md' })
  path!: string;

  @ApiProperty({ example: 3712 })
  size!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
