import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IGraphLabelsResult } from '../domain/knowledge.types';

export class GetGraphLabelsDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring filter' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class GraphLabelsDto implements IGraphLabelsResult {
  @ApiProperty({ type: [String] }) labels: string[];
  @ApiProperty() total: number;
  @ApiProperty() truncated: boolean;
}
