import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as unzipper from 'unzipper';
import { IFileGateway } from './file.gateway';
import {
  IMPORT_MAX_ARCHIVE_BYTES,
  IMPORT_MAX_ENTRIES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_UNCOMPRESSED_BYTES,
  IMPORT_PLAN_LIST_ROWS,
} from './file.limits';
import {
  IArchiveEntry,
  IImportCounts,
  IImportPlan,
  IImportPlanEntry,
  IImportResult,
  ImportMode,
} from './import.types';
/**
 * Prefixes the runtime owns at run time (chat transcripts, session state).
 * An import skips them unless the operator opts in — restoring a session
 * file from another agent is almost never what "load these files" means.
 */
export const RUNTIME_OWNED_PREFIXES = ['sessions/', 'data/sessions/'];

/** Top-level folders of a workspace — never mistaken for a wrapper. */
const WORKSPACE_FOLDERS = new Set([
  'data',
  'memory',
  'skills',
  'workspace',
  'sessions',
]);

const APPLY_CONCURRENCY = 4;

interface ValidatedArchive {
  entries: IArchiveEntry[];
  wrapperStripped: string | null;
}

interface PlanOptions {
  mode: ImportMode;
  includeSessions: boolean;
}

/**
 * Validates, plans and applies a workspace archive (CLEAN-112, research R4).
 * Memory based: nothing is extracted to disk. The API is the authority for
 * every limit (domain/file.limits.ts).
 */
@Injectable()
export class WorkspaceArchiveService {
  constructor(private readonly files: IFileGateway) {}

  /**
   * Parse and check the whole archive. Any offending entry refuses the
   * archive as a whole — the message names it — so the plan is computed only
   * over entries that are safe to write.
   */
  async validate(zip: Buffer): Promise<ValidatedArchive> {
    if (zip.length > IMPORT_MAX_ARCHIVE_BYTES) {
      throw new BadRequestException(
        `archive: exceeds ${IMPORT_MAX_ARCHIVE_BYTES} bytes (${zip.length})`,
      );
    }

    let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>;
    try {
      directory = await unzipper.Open.buffer(zip);
    } catch (err) {
      throw new BadRequestException(
        `archive: not a zip archive (${(err as Error).message})`,
      );
    }

    const raw: Array<{ path: string; file: unzipper.File }> = [];
    let totalUncompressed = 0;

    for (const file of directory.files) {
      if (file.type === 'Directory') continue;
      if (file.path.endsWith('/')) continue;

      if (raw.length + 1 > IMPORT_MAX_ENTRIES) {
        throw new BadRequestException(
          `archive: too many entries (>${IMPORT_MAX_ENTRIES})`,
        );
      }
      if ((file.flags & 0x1) !== 0) {
        throw new BadRequestException(
          `archive: encrypted entry not allowed (${file.path})`,
        );
      }
      const unixMode = (file.externalFileAttributes >>> 16) & 0xffff;
      if ((unixMode & 0o170000) === 0o120000) {
        throw new BadRequestException(
          `archive: symbolic link not allowed (${file.path})`,
        );
      }
      if (file.uncompressedSize > IMPORT_MAX_FILE_BYTES) {
        throw new BadRequestException(
          `archive: ${file.path} exceeds ${IMPORT_MAX_FILE_BYTES} bytes (${file.uncompressedSize})`,
        );
      }
      totalUncompressed += file.uncompressedSize;
      if (totalUncompressed > IMPORT_MAX_UNCOMPRESSED_BYTES) {
        throw new BadRequestException(
          `archive: uncompressed size exceeds ${IMPORT_MAX_UNCOMPRESSED_BYTES} bytes`,
        );
      }

      raw.push({ path: this.safeEntryPath(file.path), file });
    }

    if (raw.length === 0) {
      throw new BadRequestException('archive: no files');
    }

    // A single wrapping folder (what "Download" of another agent produces
    // once unpacked and re-zipped from a desktop) is the workspace root.
    const wrapperStripped = this.wrapperOf(raw.map((r) => r.path));
    if (wrapperStripped) {
      for (const r of raw) r.path = r.path.slice(wrapperStripped.length + 1);
    }

    const seen = new Map<string, string>();
    for (const r of raw) {
      const key = r.path.toLowerCase();
      const other = seen.get(key);
      if (other !== undefined) {
        throw new BadRequestException(
          `archive: paths differ only by case (${other} / ${r.path})`,
        );
      }
      seen.set(key, r.path);
    }

    const entries: IArchiveEntry[] = [];
    for (const r of raw) {
      let bytes: Buffer;
      try {
        bytes = await r.file.buffer();
      } catch (err) {
        throw new BadRequestException(
          `archive: cannot read ${r.path} (${(err as Error).message})`,
        );
      }
      // Trust the bytes, not the header — a crafted header can under-report.
      if (bytes.length > IMPORT_MAX_FILE_BYTES) {
        throw new BadRequestException(
          `archive: ${r.path} exceeds ${IMPORT_MAX_FILE_BYTES} bytes (${bytes.length})`,
        );
      }
      entries.push({
        path: r.path,
        size: bytes.length,
        md5: crypto.createHash('md5').update(bytes).digest('hex'),
        bytes,
      });
    }

    return { entries, wrapperStripped };
  }

  /** Classify every entry against the current S3 state. Writes nothing. */
  async plan(
    agentId: string,
    entries: IArchiveEntry[],
    opts: PlanOptions,
    extra: { importId?: string; wrapperStripped?: string | null } = {},
  ): Promise<IImportPlan> {
    const existing = await this.files.listWithEtags(agentId);
    const byPath = new Map(existing.map((e) => [e.path, e]));
    const inArchive = new Set(entries.map((e) => e.path));

    const rows: IImportPlanEntry[] = [];
    const counts: IImportCounts = {
      add: 0,
      change: 0,
      unchanged: 0,
      remove: 0,
      skip: 0,
    };
    let totalBytes = 0;
    let multipart = 0;

    for (const entry of entries) {
      if (!opts.includeSessions && this.isRuntimeOwned(entry.path)) {
        counts.skip += 1;
        rows.push({
          path: entry.path,
          action: 'skip',
          size: entry.size,
          reason: 'runtime-owned session state',
        });
        continue;
      }
      const current = byPath.get(entry.path);
      if (!current) {
        counts.add += 1;
        totalBytes += entry.size;
        rows.push({ path: entry.path, action: 'add', size: entry.size });
        continue;
      }
      if (current.etag.includes('-')) {
        multipart += 1;
        counts.change += 1;
        totalBytes += entry.size;
        rows.push({
          path: entry.path,
          action: 'change',
          size: entry.size,
          reason: 'multipart ETag — treated as changed',
        });
        continue;
      }
      if (current.etag === entry.md5) {
        counts.unchanged += 1;
        rows.push({ path: entry.path, action: 'unchanged', size: entry.size });
        continue;
      }
      counts.change += 1;
      totalBytes += entry.size;
      rows.push({ path: entry.path, action: 'change', size: entry.size });
    }

    if (opts.mode === 'replace') {
      for (const current of existing) {
        if (inArchive.has(current.path)) continue;
        if (!opts.includeSessions && this.isRuntimeOwned(current.path))
          continue;
        counts.remove += 1;
        rows.push({ path: current.path, action: 'remove', size: current.size });
      }
    }

    const warnings: string[] = [];
    if (multipart > 0) {
      warnings.push(
        `${multipart} file${multipart === 1 ? '' : 's'} use multipart ETags — treated as changed`,
      );
    }

    return {
      importId: extra.importId ?? '',
      mode: opts.mode,
      includeSessions: opts.includeSessions,
      wrapperStripped: extra.wrapperStripped ?? null,
      counts,
      totalBytes,
      entries: rows.slice(0, IMPORT_PLAN_LIST_ROWS),
      more: Math.max(0, rows.length - IMPORT_PLAN_LIST_ROWS),
      warnings,
    };
  }

  /**
   * Write what the plan says, collecting failures instead of stopping: the
   * result names what did not land, and a re-run of the plan shows it again
   * as add/change (FR-016). The plan passed in must be the full one — this
   * re-derives the action per entry rather than trusting the capped rows.
   */
  async apply(
    agentId: string,
    entries: IArchiveEntry[],
    plan: IImportPlan,
  ): Promise<IImportResult> {
    const full = await this.plan(agentId, entries, {
      mode: plan.mode,
      includeSessions: plan.includeSessions,
    });
    // Uncapped classification for every entry: recompute the action map
    // from the same rules as `plan()` but without the row cap.
    const actions = await this.actionsFor(agentId, entries, {
      mode: plan.mode,
      includeSessions: plan.includeSessions,
    });

    const failed: { path: string; reason: string }[] = [];
    let written = 0;
    let removed = 0;

    const toWrite = entries.filter((e) => {
      const a = actions.get(e.path);
      return a === 'add' || a === 'change';
    });

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < toWrite.length) {
        const entry = toWrite[cursor++];
        try {
          await this.files.putObjectRaw(agentId, entry.path, entry.bytes);
          written += 1;
        } catch (err) {
          failed.push({ path: entry.path, reason: (err as Error).message });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(APPLY_CONCURRENCY, toWrite.length) },
        worker,
      ),
    );

    for (const [path, action] of actions) {
      if (action !== 'remove') continue;
      try {
        await this.files.delete(agentId, path);
        removed += 1;
      } catch (err) {
        failed.push({ path, reason: (err as Error).message });
      }
    }

    return {
      importId: plan.importId,
      mode: plan.mode,
      written,
      removed,
      skipped: full.counts.skip,
      failed,
      restartRequired: false,
    };
  }

  /** Uncapped path → action map; same rules as `plan()`. */
  private async actionsFor(
    agentId: string,
    entries: IArchiveEntry[],
    opts: PlanOptions,
  ): Promise<Map<string, IImportPlanEntry['action']>> {
    const existing = await this.files.listWithEtags(agentId);
    const byPath = new Map(existing.map((e) => [e.path, e]));
    const inArchive = new Set(entries.map((e) => e.path));
    const out = new Map<string, IImportPlanEntry['action']>();
    for (const entry of entries) {
      if (!opts.includeSessions && this.isRuntimeOwned(entry.path)) {
        out.set(entry.path, 'skip');
        continue;
      }
      const current = byPath.get(entry.path);
      if (!current) out.set(entry.path, 'add');
      else if (current.etag.includes('-') || current.etag !== entry.md5)
        out.set(entry.path, 'change');
      else out.set(entry.path, 'unchanged');
    }
    if (opts.mode === 'replace') {
      for (const current of existing) {
        if (inArchive.has(current.path)) continue;
        if (!opts.includeSessions && this.isRuntimeOwned(current.path))
          continue;
        out.set(current.path, 'remove');
      }
    }
    return out;
  }

  private isRuntimeOwned(path: string): boolean {
    return RUNTIME_OWNED_PREFIXES.some((p) => path.startsWith(p));
  }

  /** Normalise separators and refuse anything that could leave the workspace. */
  private safeEntryPath(entryPath: string): string {
    const norm = entryPath.replace(/\\/g, '/');
    if (norm.includes('\0')) {
      throw new BadRequestException(`archive: invalid path (${entryPath})`);
    }
    if (/^[A-Za-z]:/.test(norm) || norm.startsWith('/')) {
      throw new BadRequestException(
        `archive: absolute path not allowed (${entryPath})`,
      );
    }
    const segments = norm.split('/');
    if (segments.some((s) => s === '..' || s === '.')) {
      throw new BadRequestException(
        `archive: path traversal not allowed (${entryPath})`,
      );
    }
    if (segments.some((s) => s === '')) {
      throw new BadRequestException(`archive: invalid path (${entryPath})`);
    }
    return norm;
  }

  /**
   * The one folder every path starts with, or null. A workspace folder
   * (`data/`, `skills/`, …) is never a wrapper: an archive holding only
   * `skills/…` is a partial workspace, not a wrapped one.
   */
  private wrapperOf(paths: string[]): string | null {
    let wrapper: string | null = null;
    for (const p of paths) {
      const slash = p.indexOf('/');
      if (slash < 0) return null; // a root-level file — nothing to strip
      const head = p.slice(0, slash);
      if (wrapper === null) wrapper = head;
      else if (wrapper !== head) return null;
    }
    if (wrapper !== null && WORKSPACE_FOLDERS.has(wrapper)) return null;
    return wrapper;
  }
}
