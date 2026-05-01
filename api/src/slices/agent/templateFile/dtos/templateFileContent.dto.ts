import { ApiProperty } from '@nestjs/swagger';

export class TemplateFileContentDto {
  @ApiProperty({ example: '.agent/agent.md' })
  path!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ example: 3712 })
  size!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
