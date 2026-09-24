import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

/** Body of `POST /agents/:id/files/export` — a selection (CLEAN-112). */
export class ExportFilesBodyDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Files, or folders by prefix. Omit for the whole workspace.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  paths?: string[];
}
