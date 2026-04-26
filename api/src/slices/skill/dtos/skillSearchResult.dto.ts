import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SkillSearchResultDto {
  @ApiProperty({ example: 'github:anthropics/skills' })
  source: string;

  @ApiProperty({ example: 'anthropics/skills' })
  repo: string;

  @ApiProperty({ example: 'pdf-skill/SKILL.md' })
  path: string;

  @ApiProperty({ example: 'pdf-skill' })
  name: string;

  @ApiProperty({ example: 'PDF skill' })
  title: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty({
    example:
      'https://github.com/anthropics/skills/blob/main/pdf-skill/SKILL.md',
  })
  url: string;

  @ApiPropertyOptional()
  snippet: string | null;
}
