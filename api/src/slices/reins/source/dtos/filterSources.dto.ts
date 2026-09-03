import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SourceIndexStatusTypes, SourceTypes } from '../domain/source.types';
import { SOURCE_INDEX_STATUSES } from './source.dto';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

export class FilterSourcesDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the source name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: SOURCE_INDEX_STATUSES })
  @IsOptional()
  @IsIn(SOURCE_INDEX_STATUSES)
  status?: SourceIndexStatusTypes;

  @ApiPropertyOptional({ enum: SOURCE_TYPES })
  @IsOptional()
  @IsIn(SOURCE_TYPES)
  type?: SourceTypes;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  perPage?: number;
}
