/**
 * What the panel's Activity section can say about a skill (CLEAN-205).
 * There is no audit log in the API, so the only facts are when the row was
 * created (and whether it came from GitHub) and when it was last written.
 * An "edited" entry only when the two differ by more than a second —
 * `updatedAt` is stamped on insert too, and "Created / Last edited" at the
 * same instant would read as two events that never happened.
 */
export type ActivityKind = 'created' | 'imported' | 'edited';

export interface ActivityEntry {
  kind: ActivityKind;
  at: string;
}

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  created: 'Created',
  imported: 'Imported from GitHub',
  edited: 'Last edited',
};

export function activityOf(skill: {
  createdAt: string;
  updatedAt: string;
  source: string | null;
}): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    { kind: skill.source ? 'imported' : 'created', at: skill.createdAt },
  ];
  const created = new Date(skill.createdAt).getTime();
  const updated = new Date(skill.updatedAt).getTime();
  if (Number.isFinite(updated) && updated - created > 1000) {
    entries.unshift({ kind: 'edited', at: skill.updatedAt });
  }
  return entries;
}
