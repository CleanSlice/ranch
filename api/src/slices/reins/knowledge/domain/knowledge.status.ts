import type { SourceIndexStateTypes } from '../../source/domain/source.types';
import type { IndexStatusTypes } from './knowledge.types';

/**
 * The base-level status is derived from its sources instead of being set
 * independently — a base can no longer read "ready" while nothing in it is
 * actually searchable (FR-031). One failing source keeps the base 'partial',
 * never 'failed' as a whole (FR-032).
 */
export function deriveIndexStatus(
  states: readonly SourceIndexStateTypes[],
): IndexStatusTypes {
  if (states.length === 0) return 'empty';
  if (states.some((s) => s === 'processing')) return 'indexing';
  if (states.every((s) => s === 'indexed')) return 'ready';
  return 'partial';
}
