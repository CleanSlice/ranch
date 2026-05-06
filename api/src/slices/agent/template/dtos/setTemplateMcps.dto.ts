import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetTemplateMcpsDto {
  @ApiProperty({
    type: [String],
    description:
      'Full list of MCP server IDs to attach. Replaces any prior set.',
  })
  @IsArray()
  @IsString({ each: true })
  mcpServerIds: string[];
}
