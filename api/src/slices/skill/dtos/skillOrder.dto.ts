import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class SkillOrderItemDto {
  @ApiProperty({ example: 'skill-…' })
  @IsString()
  id: string;

  @ApiProperty({ example: 3, description: '1-based position in the library' })
  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class SkillOrderDto {
  @ApiProperty({
    description:
      'Hash of every position. Send it back with PATCH /skills/order; a save ' +
      'against an older version is refused with 409 ORDER_CHANGED.',
  })
  version: string;

  @ApiProperty({ type: [SkillOrderItemDto] })
  items: SkillOrderItemDto[];
}
