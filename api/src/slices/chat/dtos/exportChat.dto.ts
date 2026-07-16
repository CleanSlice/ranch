import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { ChatExportFormat } from '../domain';

export class ExportChatQueryDto {
  @ApiPropertyOptional({
    enum: ['json', 'markdown', 'csv'],
    default: 'json',
    description:
      'Download format. json = raw messages, markdown/csv = transcript.',
  })
  @IsOptional()
  @IsIn(['json', 'markdown', 'csv'])
  format?: ChatExportFormat;
}
