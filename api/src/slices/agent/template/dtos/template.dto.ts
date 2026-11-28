import { ApiProperty } from '@nestjs/swagger';

export class TemplateDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  image: string;

  @ApiProperty()
  defaultConfig: Record<string, unknown>;

  @ApiProperty()
  defaultResources: { cpu: string; memory: string };

  @ApiProperty({ type: [String] })
  defaultKnowledgeIds: string[];

  @ApiProperty({
    type: [String],
    description: 'IDs of skills attached to this template.',
  })
  skillIds: string[];

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Documents MCP tool names agents of this template may list and call; null means every tool (CLEAN-209).',
  })
  toolAllowlist: string[] | null;

  @ApiProperty({
    type: [String],
    description: 'IDs of MCP servers attached to this template.',
  })
  mcpServerIds: string[];

  @ApiProperty({
    description:
      'True when the Ranch assistant is built from this resource (CLEAN-271): only the Owner can change it, and a console shows it read-only to anybody else.',
  })
  assistantDependency: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
