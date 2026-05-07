import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import { TemplateInstallService } from './domain/templateInstall.service';
import { IInstallParamValues } from './domain';
import { InstallPreviewDto, InstallResultDto } from './dtos';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('templates')
@Controller('templates/install')
export class TemplateInstallController {
  constructor(private readonly service: TemplateInstallService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Preview template install — parse manifest and report what would happen, no DB or S3 writes.',
    operationId: 'previewTemplateInstall',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        archive: { type: 'string', format: 'binary' },
        params: {
          type: 'string',
          description:
            'JSON object of operator-supplied params (e.g. {"language":"ru"}). Empty string or omitted = no params.',
        },
      },
      required: ['archive'],
    },
  })
  @ApiOkResponse({ type: InstallPreviewDto })
  @UseInterceptors(FileInterceptor('archive'))
  async preview(
    @UploadedFile() archive: UploadedFileLike | undefined,
    @Body('params') params?: string,
  ): Promise<InstallPreviewDto> {
    const buf = this.requireZip(archive);
    const result = await this.service.preview(buf, this.parseParams(params));
    return {
      manifest: result.manifest as unknown as Record<string, unknown>,
      willCreate: result.willCreate,
      willUpgrade: result.willUpgrade,
      existingTemplateId: result.existingTemplateId,
      declared: result.declared,
      files: result.files,
      warnings: result.warnings,
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Install a template from a zip archive.',
    operationId: 'installTemplate',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        archive: { type: 'string', format: 'binary' },
        params: {
          type: 'string',
          description: 'JSON object of operator-supplied params.',
        },
      },
      required: ['archive'],
    },
  })
  @ApiOkResponse({ type: InstallResultDto })
  @UseInterceptors(FileInterceptor('archive'))
  async install(
    @UploadedFile() archive: UploadedFileLike | undefined,
    @Body('params') params?: string,
  ): Promise<InstallResultDto> {
    const buf = this.requireZip(archive);
    return this.service.install(buf, this.parseParams(params));
  }

  private requireZip(file: UploadedFileLike | undefined): Buffer {
    if (!file) throw new BadRequestException('archive is required');
    if (!/zip/i.test(file.mimetype) && !/\.zip$/i.test(file.originalname)) {
      throw new BadRequestException(
        `archive must be a .zip file (got mimetype=${file.mimetype}, name=${file.originalname})`,
      );
    }
    return file.buffer;
  }

  private parseParams(raw?: string): IInstallParamValues {
    if (!raw || raw.trim() === '') return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('must be a JSON object');
      }
      return parsed as IInstallParamValues;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`params: invalid JSON — ${msg}`);
    }
  }
}
