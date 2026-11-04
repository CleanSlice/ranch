import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ValidateIf } from 'class-validator';

export class SetTemplateToolsDto {
  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Full list of Documents MCP tool names agents of this template may list and call; replaces any prior list. `null` restores every tool (the default).',
    example: ['query_knowledge', 'list_knowledge_documents'],
  })
  @ValidateIf((o: SetTemplateToolsDto) => o.toolNames !== null)
  @IsArray()
  @IsString({ each: true })
  toolNames: string[] | null;
}
