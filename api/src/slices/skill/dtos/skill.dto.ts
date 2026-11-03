import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SKILL_GROUPS, SkillGroup } from '../domain/skill.groups';

export class SkillTemplateRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Product Advisor' })
  name: string;
}

export class SkillDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'devops' })
  name: string;

  @ApiProperty({ example: 'DevOps engineer' })
  title: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty({ description: 'Markdown body of the skill (SKILL.md)' })
  body: string;

  @ApiProperty({
    description: 'Sibling files mounted alongside SKILL.md',
    isArray: true,
    example: [{ path: 'references/security.md', content: '# Security…' }],
  })
  files: { path: string; content: string }[];

  @ApiProperty({ description: 'Number of sibling files besides SKILL.md' })
  filesCount: number;

  @ApiPropertyOptional({ description: 'Origin URL if imported' })
  source: string | null;

  @ApiPropertyOptional({
    enum: SKILL_GROUPS,
    enumName: 'SkillGroup',
    nullable: true,
    description: 'Library group on the admin Skills page',
  })
  group: SkillGroup | null;

  @ApiProperty({
    description:
      'Shared display order of the Skills page. Changes nothing for agents or templates.',
  })
  sortOrder: number;

  @ApiProperty({ description: 'ceil(body.length / 4), shown as "≈ N tokens"' })
  tokenEstimate: number;

  @ApiProperty({
    type: [SkillTemplateRefDto],
    description: 'Templates that ship this skill (read-only here)',
  })
  templates: SkillTemplateRefDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
