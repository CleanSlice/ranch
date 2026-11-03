import type { CreateSkillDto } from '#api/data/repositories/api/types.gen';

/**
 * The library groups of the Skills page (CLEAN-205): label and colour for
 * each key the API accepts. The keys are the API's
 * (`api/src/slices/skill/domain/skill.groups.ts`); the `satisfies` below and
 * the `Generated` check tie this file to the generated `SkillDto.group`, so
 * a group added on one side without the other fails the typecheck.
 *
 * Colour comes with a text tag everywhere a group is shown: the row's chip,
 * the panel's chip and the legend all carry the label, so colour is never
 * the only cue. Chip pairs are the 800/100 (dark: 200/900) Tailwind steps,
 * which clear 4.5:1 for small text.
 */
export type SkillGroup = 'api' | 'routing' | 'spec-lookup' | 'answer-format' | 'runtime';

// The SDK generates a string enum (the response DTO is not in the spec, the
// request DTO carries the same enum); `${…}` reads its values back as literals.
type Generated = `${NonNullable<CreateSkillDto['group']>}`;
// Both directions: every generated key is known here, every key here exists in the API.
const _groupsMatchTheApi: [Generated] extends [SkillGroup]
  ? [SkillGroup] extends [Generated]
    ? true
    : never
  : never = true;
void _groupsMatchTheApi;

export interface SkillGroupMeta {
  label: string;
  /** The text tag on a row, in the panel, on a chip. */
  chip: string;
  /** The 3 px vertical mark at the left of a row. */
  mark: string;
  /** A segment of the size strip and the legend swatch. */
  strip: string;
}

export const SKILL_GROUP_KEYS: readonly SkillGroup[] = [
  'api',
  'routing',
  'spec-lookup',
  'answer-format',
  'runtime',
];

export const SKILL_GROUP_META = {
  api: {
    label: 'API',
    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    mark: 'bg-blue-500',
    strip: 'bg-blue-400 dark:bg-blue-500',
  },
  routing: {
    label: 'Routing',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
    mark: 'bg-violet-500',
    strip: 'bg-violet-400 dark:bg-violet-500',
  },
  'spec-lookup': {
    label: 'Spec lookup',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    mark: 'bg-emerald-500',
    strip: 'bg-emerald-400 dark:bg-emerald-500',
  },
  'answer-format': {
    label: 'Answer format',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    mark: 'bg-amber-500',
    strip: 'bg-amber-400 dark:bg-amber-500',
  },
  runtime: {
    label: 'Runtime',
    chip: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    mark: 'bg-slate-600',
    strip: 'bg-slate-500 dark:bg-slate-400',
  },
} as const satisfies Record<SkillGroup, SkillGroupMeta>;

export const UNGROUPED_META: SkillGroupMeta = {
  label: 'Ungrouped',
  chip: 'bg-muted text-muted-foreground',
  mark: 'bg-border',
  strip: 'bg-muted-foreground/40',
};

export function groupMeta(group: SkillGroup | null | undefined): SkillGroupMeta {
  return group ? SKILL_GROUP_META[group] : UNGROUPED_META;
}

export function isSkillGroup(value: unknown): value is SkillGroup {
  return typeof value === 'string' && (SKILL_GROUP_KEYS as readonly string[]).includes(value);
}
