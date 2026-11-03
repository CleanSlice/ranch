/**
 * The slug the New skill form derives from the title until the admin edits
 * it by hand (CLEAN-205), and the rule it is checked against — the same
 * `^[a-z0-9][a-z0-9-]*$` the API's DTO enforces, so a name the form accepts
 * is a name the server accepts.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type SlugError = 'Name is required' | 'Use lowercase letters, digits and dashes' | null;

export function slugError(value: string): SlugError {
  const v = value.trim();
  if (!v) return 'Name is required';
  if (!SLUG_RE.test(v)) return 'Use lowercase letters, digits and dashes';
  return null;
}

/** `.agent/skills/<slug>/` — where the skill lands inside every agent. */
export const skillFolder = (slug: string): string => `.agent/skills/${slug}/`;
