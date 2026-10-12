import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, IsOptional } from 'class-validator';
import type { ReaderAccessTypes } from '../domain/knowledge.types';

export class UpdateKnowledgeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    enum: ['closed', 'open'],
    description:
      'Whether people an agent answers may open and download the documents of this base that were cited to them (CLEAN-138). Per base, never per source.',
  })
  @IsOptional()
  @IsIn(['closed', 'open'])
  readerAccess?: ReaderAccessTypes;
}
