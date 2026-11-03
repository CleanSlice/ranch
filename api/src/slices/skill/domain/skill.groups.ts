/**
 * The library groups a skill can belong to on the admin Skills page
 * (CLEAN-205). This tuple is what the DTOs validate against and what Swagger
 * publishes as the enum, so the admin's copy of labels and colours
 * (`admin/slices/skill/domain/skill.groups.ts`) is typed against it through
 * the generated SDK: a key added here without a colour there fails the
 * admin typecheck, and vice versa.
 */
export const SKILL_GROUPS = [
  'api',
  'routing',
  'spec-lookup',
  'answer-format',
  'runtime',
] as const;

export type SkillGroup = (typeof SKILL_GROUPS)[number];

export function isSkillGroup(value: unknown): value is SkillGroup {
  return (
    typeof value === 'string' &&
    (SKILL_GROUPS as readonly string[]).includes(value)
  );
}
