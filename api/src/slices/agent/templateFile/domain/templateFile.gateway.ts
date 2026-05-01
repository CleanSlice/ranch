import {
  ITemplateFileContent,
  ITemplateFileNode,
  ITemplateFileUpload,
} from './templateFile.types';

export abstract class ITemplateFileGateway {
  abstract list(templateId: string): Promise<ITemplateFileNode[]>;
  abstract read(
    templateId: string,
    path: string,
  ): Promise<ITemplateFileContent>;
  abstract save(
    templateId: string,
    path: string,
    content: string,
  ): Promise<void>;
  abstract uploadMany(
    templateId: string,
    files: ITemplateFileUpload[],
  ): Promise<void>;
  abstract wipe(templateId: string): Promise<void>;
}
