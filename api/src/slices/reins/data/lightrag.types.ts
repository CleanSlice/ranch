import { QueryModeTypes } from '../domain/reins.types';

export interface IIngestTextInput {
  workspace: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  workspace: string;
  url: string;
}

export interface IIngestFileInput {
  workspace: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  workspace: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

export interface IQueryResultItem {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}

export interface ILightragHealth {
  ok: boolean;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
