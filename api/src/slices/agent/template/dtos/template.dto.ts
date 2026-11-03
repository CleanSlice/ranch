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

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
