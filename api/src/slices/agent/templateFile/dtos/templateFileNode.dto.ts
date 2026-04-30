import { ApiProperty } from '@nestjs/swagger';

export class TemplateFileNodeDto {
  @ApiProperty({ example: '.agent/agent.md' })
  path!: string;

  @ApiProperty({ example: 3712 })
  size!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
