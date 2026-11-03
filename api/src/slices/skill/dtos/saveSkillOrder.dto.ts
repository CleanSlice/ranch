import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SkillOrderItemDto } from './skillOrder.dto';

export class SaveSkillOrderDto {
  @ApiProperty({ description: 'The version GET /skills/order returned' })
  @IsString()
  version: string;

  @ApiProperty({
    type: [SkillOrderItemDto],
    description:
      'Every skill exactly once with its new position. Order only — agents ' +
      'and templates are not affected.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SkillOrderItemDto)
  items: SkillOrderItemDto[];
}
