import type { IFileContent, IFileNode } from './templateFile.types';

/**
 * Contract for a template's file workspace. Implemented by
 * `TemplateFileGateway`.
 */
export abstract class ITemplateFileGateway {
  abstract list(templateId: string): Promise<IFileNode[]>;
  abstract read(templateId: string, path: string): Promise<IFileContent>;
  abstract save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<IFileContent>;
  abstract upload(templateId: string, files: File[]): Promise<IFileNode[]>;
}
