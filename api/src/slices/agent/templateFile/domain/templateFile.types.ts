export interface ITemplateFileNode {
  path: string;
  size: number;
  updatedAt: Date;
}

export interface ITemplateFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: Date;
}

export interface ITemplateFileUpload {
  path: string;
  buffer: Buffer;
  contentType?: string;
}
