/**
 * The tabs of the template page and how `?tab=` picks one (CLEAN-210).
 *
 * The id list is derived from the union, not written twice, so a tab added
 * to one cannot be missing from the other: that is how the Tools tab of
 * CLEAN-209 shipped unreachable, present in the type and absent from the
 * array the query was validated against.
 */
export const TEMPLATE_TAB_IDS = [
  "overview",
  "skills",
  "mcp",
  "tools",
  "knowledge",
  "files",
  "evaluations",
] as const;

export type TemplateTabId = (typeof TEMPLATE_TAB_IDS)[number];

/** The tab a `?tab=` query names, or Overview when it names none or an unknown one. */
export function templateTabFromQuery(value: unknown): TemplateTabId {
  return typeof value === "string" &&
    (TEMPLATE_TAB_IDS as readonly string[]).includes(value)
    ? (value as TemplateTabId)
    : "overview";
}
