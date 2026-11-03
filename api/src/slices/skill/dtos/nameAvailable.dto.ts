import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class NameAvailableQueryDto {
  @ApiProperty({ example: 'devops', description: 'Slug to check' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'name must be a slug: lowercase letters, digits and dashes (e.g. "devops")',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'A skill whose own name does not count as taken (Edit skill)',
  })
  @IsOptional()
  @IsString()
  excludeId?: string;
}

export class NameAvailableDto {
  @ApiProperty({ example: 'devops' })
  name: string;

  @ApiProperty()
  available: boolean;

  @ApiPropertyOptional({ description: 'The skill that holds the name, if any' })
  existingId?: string;
}
