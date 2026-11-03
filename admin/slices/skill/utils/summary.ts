import { editedThisWeek } from './editTime';

/**
 * The four numbers over the Skills list and the size strip under them
 * (CLEAN-205). Pure over the store's records so a test can pin each one.
 */
export interface SummarySkill {
  id: string;
  name: string;
  tokenEstimate: number;
  updatedAt: string;
  templates: readonly { id: string }[];
}

export interface LibrarySummary {
  count: number;
  /** Sum of every skill's estimate — shown as "≈ 18.9k". */
  totalTokens: number;
  editedThisWeek: number;
  /** The newest edit in the library, for "last 12 min ago". */
  latestEdit: string | null;
  /** Slugs of skills no template ships, in list order. */
  unused: string[];
}

export function librarySummary(skills: readonly SummarySkill[], now: Date): LibrarySummary {
  const week = editedThisWeek(skills, now);
  return {
    count: skills.length,
    totalTokens: skills.reduce((sum, s) => sum + Math.max(0, s.tokenEstimate), 0),
    editedThisWeek: week.count,
    latestEdit: week.latest,
    unused: skills.filter((s) => s.templates.length === 0).map((s) => s.name),
  };
}

export interface StripSegment {
  id: string;
  slug: string;
  tokens: number;
  /** `flex-grow`; CSS gives every segment an 8 px floor, this gives the ratio. */
  grow: number;
}

/** One segment per skill, in the order the list shows them. */
export function stripSegments(skillsInOrder: readonly SummarySkill[]): StripSegment[] {
  return skillsInOrder.map((s) => ({
    id: s.id,
    slug: s.name,
    tokens: s.tokenEstimate,
    grow: Math.max(1, s.tokenEstimate),
  }));
}

/** "9% of library": whole percent, never NaN on an empty library. */
export function shareOfLibrary(tokens: number, totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  return Math.round((tokens / totalTokens) * 100);
}
