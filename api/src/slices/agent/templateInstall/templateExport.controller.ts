import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { TemplateExportService } from './domain/templateExport.service';

@ApiTags('templates')
@Controller('templates')
export class TemplateExportController {
  constructor(private readonly service: TemplateExportService) {}

  // Using @Res() bypasses the global ResponseInterceptor envelope —
  // it only wraps observable returns; raw express response writes go
  // straight through.
  @Get(':id/download')
  @ApiOperation({
    summary:
      'Download a template as a zip — round-trips template.yaml, .agent/*, .paddock/config.json, and .paddock/scenarios/* back into an installable bundle.',
    operationId: 'downloadTemplate',
  })
  async download(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.service.exportZip(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
  }
}
