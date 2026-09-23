import type { FileKind } from './fileKind';

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: Date;
  /** Text or binary, decided by the API (CLEAN-112). */
  kind: FileKind;
  /** `kind === 'text'` and within MAX_EDIT_BYTES. */
  editable: boolean;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: Date;
  kind: FileKind;
  editable: boolean;
}

/** Options for `IFileGateway.save` (CLEAN-112). */
export interface ISaveOptions {
  /** 409 when the object already exists. */
  createOnly?: boolean;
  /** 412 when the object was modified after this instant. */
  ifUnmodifiedSince?: Date;
}

export interface IFileChunk {
  path: string;
  content: string;
  kind: FileKind;
  editable: boolean;
  // Byte length of the returned `content` slice (after utf-8 encoding).
  size: number;
  // Full byte length of the object in S3.
  totalSize: number;
  // Byte offset of the first byte of `content`.
  offset: number;
  // Byte offset to pass next to continue reading. `null` when this chunk
  // ends at the end of the file.
  nextOffset: number | null;
  hasMore: boolean;
  updatedAt: Date;
}

// Primitive shape passed to syncSkills — kept local to the file slice
// so the gateway doesn't depend on the skill slice's types directly.
export interface ISkillBundle {
  name: string;
  body: string;
  files: { path: string; content: string }[];
}
