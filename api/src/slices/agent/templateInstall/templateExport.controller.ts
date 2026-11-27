import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { TemplateExportService } from './domain/templateExport.service';

@ApiTags('templates')
@Controller('templates')
export class TemplateExportController {
  constructor(
    private readonly service: TemplateExportService,
    private readonly build: AssistantBuildService,
  ) {}

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
    @Req() req?: Request,
  ): Promise<void> {
    // The scenarios of a template the assistant is built from are the
    // Owner's to read (CLEAN-271): anybody else's archive has none.
    const user = (req as (Request & { user?: IAuthTokenPayload }) | undefined)
      ?.user;
    const withoutScenarios =
      !AssistantBuildService.isOwner(user) &&
      (await this.build.isIngredient('template', id));
    const { filename, buffer } = await this.service.exportZip(id, {
      withoutScenarios,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
  }
}
