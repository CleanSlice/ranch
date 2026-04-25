export interface IFileNode {
  path: string;
  size: number;
  updatedAt: Date;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: Date;
}
