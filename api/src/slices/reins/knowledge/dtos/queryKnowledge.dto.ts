import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { QueryModeTypes } from '../domain/reins.types';

const QUERY_MODES: QueryModeTypes[] = ['hybrid', 'local', 'global', 'naive'];

export class QueryKnowledgeDto {
  @ApiProperty()
  @IsString()
  query: string;

  @ApiPropertyOptional({ enum: QUERY_MODES, default: 'hybrid' })
  @IsOptional()
  @IsEnum(QUERY_MODES)
  mode?: QueryModeTypes;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number;
}
