import { TemplateFilesService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ITemplateFileGateway } from '../domain/templateFile.gateway';
import type { IFileContent, IFileNode } from '../domain/templateFile.types';
import { TemplateFileMapper } from './templateFile.mapper';

export class TemplateFileGateway
  extends BaseGateway
  implements ITemplateFileGateway
{
  private mapper = new TemplateFileMapper();

  list(templateId: string): Promise<IFileNode[]> {
    return this.execute(async () => {
      const res = await TemplateFilesService.templateFileControllerList({
        path: { id: templateId },
      });
      return this.mapper.toNodeList(unwrapEnvelope(res.data));
    });
  }

  read(templateId: string, path: string): Promise<IFileContent> {
    return this.execute(async () => {
      const res = await TemplateFilesService.templateFileControllerRead({
        path: { id: templateId },
        query: { path },
      });
      return this.contentOrThrow(res, 'Failed to load file');
    });
  }

  save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    return this.execute(async () => {
      const res = await TemplateFilesService.templateFileControllerSave({
        path: { id: templateId },
        query: { path },
        body: { content },
      });
      return this.contentOrThrow(res, 'Failed to save file');
    });
  }

  upload(templateId: string, files: File[]): Promise<IFileNode[]> {
    return this.execute(async () => {
      // Preserve the folder structure the user picked (webkitRelativePath).
      const paths = files.map(
        (f) =>
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name,
      );
      const res = await TemplateFilesService.templateFileControllerUpload({
        path: { id: templateId },
        body: { files, paths },
      });
      return this.mapper.toNodeList(unwrapEnvelope(res.data));
    });
  }

  private contentOrThrow(res: { data?: unknown }, fallback: string): IFileContent {
    const content = this.mapper.toContent(unwrapEnvelope(res.data));
    if (!content) {
      const err = (res as { error?: { message?: string } }).error;
      throw new Error(err?.message ?? fallback);
    }
    return content;
  }
}
