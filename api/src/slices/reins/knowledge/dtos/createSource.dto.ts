import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { SourceTypes } from '../domain/reins.types';

const SOURCE_TYPES: SourceTypes[] = ['file', 'url', 'text'];

export class CreateSourceDto {
  @ApiProperty({ enum: SOURCE_TYPES })
  @IsEnum(SOURCE_TYPES)
  type: SourceTypes;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;
}
