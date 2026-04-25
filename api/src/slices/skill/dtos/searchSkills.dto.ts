import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SearchSkillsDto {
  @ApiProperty({ example: 'pdf parsing' })
  @IsString()
  @MinLength(2)
  q: string;
}
