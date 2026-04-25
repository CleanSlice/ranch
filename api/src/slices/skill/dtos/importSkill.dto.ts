import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Matches, IsUrl } from 'class-validator';

export class ImportSkillDto {
  @ApiProperty({
    example: 'anthropics/skills',
    description: 'GitHub owner/repo as returned by /skills/search',
  })
  @IsString()
  repo: string;

  @ApiProperty({
    example: 'pdf-skill/SKILL.md',
    description: 'Path to the SKILL.md file inside the repo',
  })
  @IsString()
  path: string;

  @ApiPropertyOptional({
    description:
      'Override the auto-derived slug. Lowercase letters, digits and dashes.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  name?: string;
}

export class ImportSkillUrlDto {
  @ApiProperty({
    description:
      'GitHub URL — folder (tree/<sha>/<path>) or file (blob/<sha>/<path>). The folder must contain a SKILL.md or README.md.',
    example:
      'https://github.com/supabase/agent-skills/tree/main/skills/supabase-postgres-best-practices',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  url: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  name?: string;
}
