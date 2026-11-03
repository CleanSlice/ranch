import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Form fields of `POST /agents/:id/files/import/stage-files` (CLEAN-192),
 * sent beside the multipart `files`. `targets` is JSON because multipart
 * fields are strings; the controller parses and validates it.
 */
export class ImportStageFilesDto {
  @ApiProperty({
    example: '[{"name":"SOUL.md","path":"SOUL.md"}]',
    description:
      'JSON array of { name, path }, one per uploaded file name. Each path must be the unique match, one of the candidates, or <targetFolder>/<name> for that name.',
  })
  @IsString()
  targets!: string;

  @ApiPropertyOptional({
    example: '',
    description: 'Relative folder for names that match nothing; empty = root.',
  })
  @IsOptional()
  @IsString()
  targetFolder?: string;
}
