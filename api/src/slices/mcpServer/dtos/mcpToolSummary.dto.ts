import { ApiProperty } from '@nestjs/swagger';

/** One tool of the built-in Documents MCP server, as the console lists it for a template tool allowlist (CLEAN-209). */
export class McpToolSummaryDto {
  @ApiProperty({ example: 'query_knowledge' })
  name!: string;

  @ApiProperty({ example: 'knowledge', nullable: true, type: String })
  topic!: string | null;

  @ApiProperty({
    example: 'Ask the knowledge bases',
    nullable: true,
    type: String,
  })
  title!: string | null;

  @ApiProperty({
    example: 'Search your bound knowledge bases for factual information.',
  })
  description!: string;
}
