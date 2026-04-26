import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: 'Origin URL if imported' })
  source: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
