import { BadRequestException } from '@nestjs/common';

/**
 * Path rules every import shares (CLEAN-112 archives, CLEAN-192 selected
 * files): one place, so the archive validator, the selected-files resolver
 * and the tool refuse exactly the same things.
 */

/**
 * Prefixes the runtime owns at run time (chat transcripts, session state).
 * An import skips them unless the operator opts in — restoring a session
 * file from another agent is almost never what "load these files" means.
 */
export const RUNTIME_OWNED_PREFIXES = ['sessions/', 'data/sessions/'];

export function isRuntimeOwned(path: string): boolean {
  return RUNTIME_OWNED_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Normalise separators and refuse anything that could leave the workspace.
 * `label` prefixes the refusal so the message says what was being checked
 * (`archive`, `targetFolder`, `target`).
 */
export function safeEntryPath(entryPath: string, label = 'archive'): string {
  const norm = entryPath.replace(/\\/g, '/');
  if (norm.includes('\0')) {
    throw new BadRequestException(`${label}: invalid path (${entryPath})`);
  }
  if (/^[A-Za-z]:/.test(norm) || norm.startsWith('/')) {
    throw new BadRequestException(
      `${label}: absolute path not allowed (${entryPath})`,
    );
  }
  const segments = norm.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new BadRequestException(
      `${label}: path traversal not allowed (${entryPath})`,
    );
  }
  if (segments.some((s) => s === '')) {
    throw new BadRequestException(`${label}: invalid path (${entryPath})`);
  }
  return norm;
}

/** The last path segment — what a dropped file is matched by. */
export function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}
