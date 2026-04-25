import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Matches } from 'class-validator';

export class CreateSkillDto {
  @ApiProperty({
    example: 'devops',
    description: 'Unique slug — lowercase letters, digits, dashes',
  })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'name must be a slug: lowercase letters, digits and dashes (e.g. "devops")',
  })
  name: string;

  @ApiProperty({ example: 'DevOps engineer' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Markdown body of the skill' })
  @IsString()
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
