import { BadRequestException } from '@nestjs/common';
import * as archiver from 'archiver';
import * as crypto from 'crypto';
import { IMPORT_MAX_FILES, IMPORT_MAX_FILE_BYTES } from './file.limits';
import { basenameOf, isRuntimeOwned, safeEntryPath } from './importPath';
import { IArchiveEntry, IImportTarget, IResolveRow } from './import.types';

/**
 * Selected-files import (CLEAN-192): a handful of plain files, each matched
 * by its exact file name anywhere in the workspace. The rule lives here,
 * once, so the Files-tab dialog and the `import_agent_files` tool give the
 * same target for the same file (spec SC-005, research R1).
 */

export interface IExistingFile {
  path: string;
  size: number;
  etag: string;
}

/** `PK\x03\x04` — what every non-empty zip starts with. */
export function isZipSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Empty means root; otherwise a relative folder, trailing slashes dropped. */
export function normaliseTargetFolder(folder: string | undefined): string {
  const trimmed = (folder ?? '').replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!trimmed) return '';
  return safeEntryPath(trimmed, 'targetFolder');
}

/** A dropped file's name: no separators, no control characters, not `.`/`..`. */
export function assertFileName(name: string): void {
  if (!name || name === '.' || name === '..') {
    throw new BadRequestException(`file name: invalid (${name})`);
  }
  if (/[\\/]/.test(name)) {
    throw new BadRequestException(
      `file name: must not contain a path separator (${name})`,
    );
  }
  // eslint-disable-next-line no-control-regex -- control characters are the point
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new BadRequestException(
      `file name: control character not allowed (${JSON.stringify(name)})`,
    );
  }
}

export function assertNames(names: string[]): void {
  if (names.length === 0) {
    throw new BadRequestException('files: at least one file is required');
  }
  if (names.length > IMPORT_MAX_FILES) {
    throw new BadRequestException(
      `files: too many files (${names.length} > ${IMPORT_MAX_FILES})`,
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    assertFileName(name);
    if (seen.has(name)) {
      throw new BadRequestException(`files: duplicate name (${name})`);
    }
    seen.add(name);
  }
}

/**
 * Match each name against the workspace: exact, case-sensitive, by the last
 * path segment, ignoring runtime-owned state. 0 matches → `none` (added in
 * the target folder), 1 → `unique` (replaced in place), 2+ → `ambiguous`
 * (the operator chooses; never guessed).
 */
export function resolveSelectedFiles(
  names: string[],
  targetFolder: string | undefined,
  existing: IExistingFile[],
): IResolveRow[] {
  assertNames(names);
  const folder = normaliseTargetFolder(targetFolder);

  const byName = new Map<string, IExistingFile[]>();
  for (const file of existing) {
    if (isRuntimeOwned(file.path)) continue;
    const base = basenameOf(file.path);
    const list = byName.get(base);
    if (list) list.push(file);
    else byName.set(base, [file]);
  }

  return names.map((name) => {
    const matches = (byName.get(name) ?? [])
      .slice()
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (matches.length === 1) {
      return {
        name,
        match: 'unique' as const,
        path: matches[0].path,
        candidates: [],
        size: matches[0].size,
      };
    }
    if (matches.length === 0) {
      return {
        name,
        match: 'none' as const,
        path: joinFolder(folder, name),
        candidates: [],
        size: null,
      };
    }
    return {
      name,
      match: 'ambiguous' as const,
      path: null,
      candidates: matches.map((m) => m.path),
      size: null,
    };
  });
}

export function joinFolder(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/**
 * The client's (or the agent's) chosen targets, checked against the rows the
 * same names resolve to right now: a `unique` or `none` row accepts only its
 * own path; an `ambiguous` row accepts one of its candidates or "add as new"
 * in the target folder. Anything else — or a missing / unknown name — is
 * refused. Returns name → path in row order.
 */
export function validateTargets(
  targets: IImportTarget[],
  rows: IResolveRow[],
  targetFolder: string | undefined,
): Map<string, string> {
  const folder = normaliseTargetFolder(targetFolder);
  const byName = new Map<string, string>();
  for (const t of targets) {
    if (!t || typeof t.name !== 'string' || typeof t.path !== 'string') {
      throw new BadRequestException('targets: each entry needs name and path');
    }
    if (byName.has(t.name)) {
      throw new BadRequestException(`targets: duplicate name (${t.name})`);
    }
    byName.set(t.name, safeEntryPath(t.path, 'target'));
  }
  const known = new Set(rows.map((r) => r.name));
  for (const name of byName.keys()) {
    if (!known.has(name)) {
      throw new BadRequestException(`targets: unknown file name (${name})`);
    }
  }

  const out = new Map<string, string>();
  for (const row of rows) {
    const chosen = byName.get(row.name);
    if (chosen === undefined) {
      throw new BadRequestException(`targets: no target for ${row.name}`);
    }
    const allowed =
      row.match === 'ambiguous'
        ? [...row.candidates, joinFolder(folder, row.name)]
        : [row.path as string];
    if (!allowed.includes(chosen)) {
      throw new BadRequestException(
        `targets: ${row.name} cannot go to ${chosen} (allowed: ${allowed.join(', ')})`,
      );
    }
    out.set(row.name, chosen);
  }
  return out;
}

/** Entries for the plan: the chosen path per file, bytes already in memory. */
export function toArchiveEntries(
  files: Array<{ name: string; bytes: Buffer }>,
  paths: Map<string, string>,
): IArchiveEntry[] {
  return files.map((f) => {
    const path = paths.get(f.name);
    if (!path) throw new BadRequestException(`targets: no target for ${f.name}`);
    if (f.bytes.length > IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException(
        `files: ${f.name} exceeds ${IMPORT_MAX_FILE_BYTES} bytes (${f.bytes.length})`,
      );
    }
    return {
      path,
      size: f.bytes.length,
      md5: crypto.createHash('md5').update(f.bytes).digest('hex'),
      bytes: f.bytes,
    };
  });
}

/** ETag each target was planned against (`null` = does not exist yet). */
export function expectedEtags(
  entries: IArchiveEntry[],
  existing: IExistingFile[],
): Record<string, string | null> {
  const byPath = new Map(existing.map((e) => [e.path, e.etag]));
  const out: Record<string, string | null> = {};
  for (const e of entries) out[e.path] = byPath.get(e.path) ?? null;
  return out;
}

/**
 * Pack the entries as a zip so the files stage is stored, loaded, planned
 * and applied by the very same code as an archive stage (research R2).
 * Paths are written verbatim; the loader passes `stripWrapper: false`.
 */
export function buildFilesZip(
  entries: Array<{ path: string; bytes: Buffer }>,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const e of entries) archive.append(e.bytes, { name: e.path });
    void archive.finalize();
  });
}
