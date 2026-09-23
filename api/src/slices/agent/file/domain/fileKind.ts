import { MAX_EDIT_BYTES } from './file.limits';

/**
 * Text-or-binary classification for workspace files (CLEAN-112, FR-001).
 *
 * The extension list is the fast path; anything not on it (or with no
 * extension at all — `Makefile`, `LICENSE`) is decided by sniffing the first
 * few KB: a NUL byte or invalid UTF-8 means binary. Consoles and tools never
 * classify on their own — they read `kind` / `editable` off the node the API
 * returns.
 */

export const TEXT_EXTENSIONS: readonly string[] = [
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.sql',
  '.log',
];

/** Extensions known to be binary — no sniffing needed. */
export const BINARY_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svgz',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.7z',
  '.rar',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.exe',
  '.dll',
  '.so',
  '.bin',
  '.sqlite',
  '.db',
];

export type FileKind = 'text' | 'binary';
export type FileKindGuess = FileKind | 'unknown';

/** How many bytes the sniff looks at. */
export const SNIFF_BYTES = 8 * 1024;

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // ".env" and ".gitignore" — a leading dot is the whole name, not an ext,
  // except for the well-known `.env` family which we want to treat as text.
  if (dot < 0) return '';
  return base.slice(dot).toLowerCase();
}

/** Decide from the path alone; `'unknown'` means "sniff the bytes". */
export function kindFromPath(path: string): FileKindGuess {
  const ext = extensionOf(path);
  if (!ext) return 'unknown';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (BINARY_EXTENSIONS.includes(ext)) return 'binary';
  return 'unknown';
}

/**
 * Sniff the head of a file: NUL byte or invalid UTF-8 → binary. A head cut
 * in the middle of a multi-byte sequence is still text, so the trailing
 * partial sequence is tolerated.
 */
export function sniffKind(head: Buffer): FileKind {
  if (head.length === 0) return 'text';
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return 'binary';
  }
  const trimmed = head.subarray(0, head.length - trailingPartialUtf8(head));
  return isValidUtf8(trimmed) ? 'text' : 'binary';
}

export function isEditable(kind: FileKind, size: number): boolean {
  return kind === 'text' && size <= MAX_EDIT_BYTES;
}

/**
 * Number of bytes at the end of `buf` that begin a UTF-8 sequence which the
 * buffer does not complete (0–3). Used by range reads so a slice never ends
 * mid-character (FR-009) and by the sniff above.
 */
export function trailingPartialUtf8(buf: Buffer): number {
  const len = buf.length;
  // Walk back over continuation bytes (10xxxxxx), at most 3.
  let i = len - 1;
  let continuation = 0;
  while (i >= 0 && continuation < 3 && (buf[i] & 0xc0) === 0x80) {
    i--;
    continuation++;
  }
  if (i < 0) return 0; // whole tail is continuation bytes — leave it, invalid anyway
  const lead = buf[i];
  let need = 0;
  if ((lead & 0x80) === 0) need = 1;
  else if ((lead & 0xe0) === 0xc0) need = 2;
  else if ((lead & 0xf0) === 0xe0) need = 3;
  else if ((lead & 0xf8) === 0xf0) need = 4;
  else return 0; // not a lead byte — nothing sensible to trim
  const have = continuation + 1;
  return have < need ? have : 0;
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
