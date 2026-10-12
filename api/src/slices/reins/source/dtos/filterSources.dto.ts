import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  SOURCE_SORTS,
  SourceIndexStatusTypes,
  SourceSortTypes,
  SourceTypes,
} from '../domain/source.types';
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

  @ApiPropertyOptional({
    enum: SOURCE_SORTS,
    default: 'createdAt',
    description:
      'Order of the page (CLEAN-138): when the source was added, or how often it was cited, liked or disliked in agent answers.',
  })
  @IsOptional()
  @IsIn(SOURCE_SORTS)
  sort?: SourceSortTypes;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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
