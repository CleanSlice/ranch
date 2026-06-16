// @scope:api
// @slice:reins/source
// @layer:data
// @type:utility

import * as path from 'path';
import * as unzipper from 'unzipper';
import { Readable } from 'stream';

export interface ArchiveEntry {
  path: string;
  size: number;
  openStream: () => Readable;
}

/**
 * Reads the central directory of a zip (cheap, no extraction) and returns
 * the entries worth ingesting. openStream is lazy - the actual bytes are
 * only read when the caller pipes the stream, so memory stays flat while
 * iterating a 500MB archive. The zip file on disk must outlive all
 * openStream calls.
 */
export async function listIngestableEntries(
  zipPath: string,
): Promise<ArchiveEntry[]> {
  const directory = await unzipper.Open.file(zipPath);
  return directory.files
    .filter(
      (f) => f.type === 'File' && isIngestableEntry(f.path, f.uncompressedSize),
    )
    .map((f) => ({
      path: f.path,
      size: f.uncompressedSize,
      openStream: (): Readable => f.stream(),
    }));
}

// Extensions we can extract usable text from downstream (LightRAG ingest).
// Everything else in an archive (images, video, fonts, audio) is skipped.
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.pptx',
  '.ppt',
  '.xlsx',
  '.xls',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.xml',
  '.csv',
  '.rtf',
  '.json',
]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.rtf': 'application/rtf',
  '.json': 'application/json',
};

/**
 * Decide whether an archive entry should become a knowledge source.
 * Filters out macOS resource forks, directories, dot-files, and any
 * extension we can't extract text from. `size` is the uncompressed size;
 * zero-byte entries are skipped (usually directory placeholders).
 */
export function isIngestableEntry(entryPath: string, size: number): boolean {
  if (size <= 0) return false;
  if (entryPath.endsWith('/')) return false;

  const base = path.basename(entryPath);
  if (entryPath.includes('__MACOSX/')) return false;
  if (base === '.DS_Store') return false;
  if (base.startsWith('._')) return false;

  const ext = path.extname(base).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function contentTypeForEntry(entryPath: string): string {
  const ext = path.extname(entryPath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

// Archive entries keep their folder structure (e.g. "Content/foo.pdf").
// Source names use just the basename for readability, but two files with the
// same basename in different folders would collide on dedup - so callers
// dedup on the full entry path, not this display name.
export function displayNameForEntry(entryPath: string): string {
  return path.basename(entryPath);
}
