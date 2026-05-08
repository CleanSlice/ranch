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
import { InstallPreviewDto, InstallResultDto, InstallFromGitDto } from './dtos';

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
    summary:
      'Preview template install — parse manifest and report what would happen, no DB or S3 writes.',
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
        secrets: {
          type: 'string',
          description:
            'JSON object of operator-supplied secrets used to resolve $secret:NAME references in the manifest (e.g. mcp[].authValue).',
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
    @Body('secrets') secrets?: string,
  ): Promise<InstallResultDto> {
    const buf = this.requireZip(archive);
    return this.service.install(
      buf,
      this.parseParams(params),
      this.parseSecrets(secrets),
    );
  }

  @Post('from-git/preview')
  @ApiOperation({
    summary:
      'Preview template install from a git repository — clones into /tmp, parses manifest, reports what would happen, no DB or S3 writes.',
    operationId: 'previewTemplateInstallFromGit',
  })
  @ApiOkResponse({ type: InstallPreviewDto })
  async previewFromGit(
    @Body() dto: InstallFromGitDto,
  ): Promise<InstallPreviewDto> {
    const result = await this.service.previewFromGit(
      dto.gitUrl,
      dto.gitRef,
      dto.params ?? {},
    );
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

  @Post('from-git')
  @ApiOperation({
    summary: 'Install a template from a git repository.',
    operationId: 'installTemplateFromGit',
  })
  @ApiOkResponse({ type: InstallResultDto })
  installFromGit(@Body() dto: InstallFromGitDto): Promise<InstallResultDto> {
    return this.service.installFromGit(
      dto.gitUrl,
      dto.gitRef,
      dto.params ?? {},
      dto.secrets ?? {},
    );
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
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('must be a JSON object');
      }
      return parsed as IInstallParamValues;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`params: invalid JSON — ${msg}`);
    }
  }

  private parseSecrets(raw?: string): Record<string, string> {
    if (!raw || raw.trim() === '') return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('must be a JSON object');
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new Error(`secret "${k}" must be a string`);
        }
        out[k] = v;
      }
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`secrets: invalid JSON — ${msg}`);
    }
  }
}
