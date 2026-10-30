import type { IFileLimits, IImportPlan, IImportTarget, IResolveRow } from '#agentFile/domain';

/**
 * Selected-files import (CLEAN-192): the small, pure rules the dialog shows
 * and gates on. Matching itself is the API's; this is only how a row reads
 * and when the operator may go on.
 */

/** A resolve row plus what the operator picked for an ambiguous name. */
export interface ITargetRow extends IResolveRow {
  /** Chosen path for an `ambiguous` row; `null` until the operator decides. */
  chosen: string | null;
}

export function toTargetRows(rows: IResolveRow[]): ITargetRow[] {
  return rows.map((r) => ({ ...r, chosen: null }));
}

/** The path a row will be written to, or null while it still needs a choice. */
export function targetPathOf(row: ITargetRow): string | null {
  return row.match === 'ambiguous' ? row.chosen : row.path;
}

export function settled(row: ITargetRow): boolean {
  return targetPathOf(row) !== null;
}

export function allSettled(rows: ITargetRow[]): boolean {
  return rows.length > 0 && rows.every(settled);
}

/** `<folder>/<name>`, or just the name at the root. */
export function addAsNewPath(targetFolder: string, name: string): string {
  const folder = targetFolder.replace(/\/+$/, '');
  return folder ? `${folder}/${name}` : name;
}

/** What the target cell says for a row. */
export function rowLabel(row: ITargetRow, targetFolder: string): string {
  if (row.match === 'unique') return `replaces ${row.path}`;
  if (row.match === 'none') return `new, ${targetFolder ? targetFolder : 'root'}`;
  if (row.chosen === null) return 'choose…';
  return row.chosen === addAsNewPath(targetFolder, row.name)
    ? `new, ${targetFolder ? targetFolder : 'root'}`
    : `replaces ${row.chosen}`;
}

export function toTargets(rows: ITargetRow[]): IImportTarget[] {
  return rows.map((r) => ({ name: r.name, path: targetPathOf(r) ?? '' }));
}

/** A plan is worth confirming only when something will actually be written. */
export function confirmable(plan: IImportPlan | null): boolean {
  if (!plan) return false;
  return plan.counts.add + plan.counts.change > 0;
}

/** Exactly one file, and it is a zip by name. */
export function isLoneZip(files: File[]): boolean {
  return files.length === 1 && /\.zip$/i.test(files[0].name);
}

/**
 * The first limit the selection breaks, as a sentence, or null. `fmt`
 * renders byte counts (the console's `formatBytes`); injected so this file
 * stays free of Nuxt aliases and runs under `bun test`.
 */
export function overLimits(
  files: File[],
  limits: Pick<IFileLimits, 'importMaxFiles' | 'importMaxFileBytes'> | null,
  fmt: (bytes: number) => string = (n) => `${n} B`,
): string | null {
  if (!limits) return null;
  if (limits.importMaxFiles && files.length > limits.importMaxFiles) {
    return `${files.length} files selected — the limit is ${limits.importMaxFiles}. Zip them and use Whole workspace.`;
  }
  const max = limits.importMaxFileBytes;
  if (max) {
    const big = files.find((f) => f.size > max);
    if (big) {
      return `${big.name} is ${fmt(big.size)} — the limit is ${fmt(max)} per file.`;
    }
  }
  return null;
}

/** Two selected files with the same name cannot both be matched. */
export function duplicateName(files: File[]): string | null {
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.name)) return f.name;
    seen.add(f.name);
  }
  return null;
}
