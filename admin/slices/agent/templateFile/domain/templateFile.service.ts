import type { ITemplateFileGateway } from './templateFile.gateway';
import type { IFileContent, IFileNode } from './templateFile.types';

/** Domain service for a template's file workspace. */
export class TemplateFileService {
  constructor(private gateway: ITemplateFileGateway) {}

  list(templateId: string): Promise<IFileNode[]> {
    return this.gateway.list(templateId);
  }

  read(templateId: string, path: string): Promise<IFileContent> {
    return this.gateway.read(templateId, path);
  }

  save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    return this.gateway.save(templateId, path, content);
  }

  upload(templateId: string, files: File[]): Promise<IFileNode[]> {
    return this.gateway.upload(templateId, files);
  }
}
