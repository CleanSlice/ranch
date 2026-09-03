import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SourceIndexStatusTypes, SourceTypes } from '../domain/source.types';
import { SOURCE_INDEX_STATUSES } from './source.dto';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

/**
 * Mirrors the list's filter so "export everything I am looking at" needs no
 * second definition of what that means. `ids` is the tick-list; when it is
 * present the filter is ignored, because the caller picked rows rather than a
 * query and the two can disagree by the time the request lands.
 */
export class ExportSourcesDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated source ids. When present the filter fields are ignored.',
  })
  @IsOptional()
  @IsString()
  ids?: string;

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
}
