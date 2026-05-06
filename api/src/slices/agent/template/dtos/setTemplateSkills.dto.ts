import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetTemplateSkillsDto {
  @ApiProperty({
    type: [String],
    description: 'Full list of skill IDs to attach. Replaces any prior set.',
  })
  @IsArray()
  @IsString({ each: true })
  skillIds: string[];
}
