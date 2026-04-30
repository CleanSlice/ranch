import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ITemplateGateway } from '#/agent/template/domain';
import { ITemplateFileGateway } from './domain';
import { ITemplateFileUpload } from './domain/templateFile.types';
import { SaveTemplateFileDto } from './dtos';

interface IMulterFile {
  fieldname: string;
  originalname: string;
  encoding?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('template-files')
@Controller('templates/:id/files')
export class TemplateFileController {
  constructor(
    private templateGateway: ITemplateGateway,
    private fileGateway: ITemplateFileGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List files for a template' })
  async list(@Param('id') id: string) {
    await this.assertTemplate(id);
    return this.fileGateway.list(id);
  }

  @Get('content')
  @ApiOperation({ summary: 'Read a template file' })
  async read(@Param('id') id: string, @Query('path') path: string) {
    await this.assertTemplate(id);
    return this.fileGateway.read(id, path);
  }

  @Put('content')
  @ApiOperation({ summary: 'Save a template file (.md / .json only)' })
  async save(
    @Param('id') id: string,
    @Query('path') path: string,
    @Body() dto: SaveTemplateFileDto,
  ) {
    await this.assertTemplate(id);
    await this.fileGateway.save(id, path, dto.content);
    await this.templateGateway.touch(id);
    return this.fileGateway.read(id, path);
  }

  @Post('upload')
  @ApiOperation({
    summary:
      'Replace template files in S3 with the uploaded folder. The body is multipart/form-data; pass a parallel "paths[]" field with the relative path for each file.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative paths matching files[] by index, e.g. ".agent/agent.md"',
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 200))
  async upload(
    @Param('id') id: string,
    @UploadedFiles() files: IMulterFile[],
    @Body('paths') rawPaths: string | string[] | undefined,
  ) {
    await this.assertTemplate(id);

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const paths = this.parsePaths(rawPaths, files);
    if (paths.length !== files.length) {
      throw new BadRequestException(
        'paths[] length must match the number of uploaded files',
      );
    }

    const uploads: ITemplateFileUpload[] = files.map((file, i) => ({
      path: paths[i],
      buffer: file.buffer,
      contentType: file.mimetype,
    }));

    await this.fileGateway.wipe(id);
    await this.fileGateway.uploadMany(id, uploads);
    await this.templateGateway.touch(id);

    return this.fileGateway.list(id);
  }

  private parsePaths(
    raw: string | string[] | undefined,
    files: IMulterFile[],
  ): string[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string'))
          return parsed as string[];
      } catch {
        return [raw];
      }
    }
    return files.map((f) => f.originalname);
  }

  private async assertTemplate(id: string): Promise<void> {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
  }
}
