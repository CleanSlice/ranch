// Domain types for a template's file workspace.

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: string;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}
