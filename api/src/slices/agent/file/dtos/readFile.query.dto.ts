import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReadFileQueryDto {
  @ApiProperty({ example: 'data/sessions/bridle:admin.jsonl' })
  @IsString()
  path!: string;

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description: 'Byte offset to start reading from.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 524288,
    default: 262144,
    description: 'Max bytes to return. Server caps at 512 KB.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(524288)
  limit?: number;
}
