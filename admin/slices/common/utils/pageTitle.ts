/**
 * The title in the top bar for a page that has no breadcrumbs (CLEAN-135):
 * the name of the sidebar section the route belongs to. `templates-id-edit`
 * belongs to the `templates` item and reads "Templates" — not the raw route
 * name, which is where "Templates Id" came from.
 *
 * Pure, so the matching is pinned by `pageTitle.test.ts`.
 */
export interface IPageTitleSection {
  /** The route name the sidebar item links to: `templates`, `api-keys`. */
  link: string;
  title: string;
}

export function pageTitle(
  routeName: string | null | undefined,
  sections: readonly IPageTitleSection[],
  fallback = 'Admin',
): string {
  const name = routeName ?? '';
  if (!name) return fallback;

  // The longest link wins, so `api-keys` is not read as a page of `api`.
  let best: IPageTitleSection | null = null;
  for (const section of sections) {
    if (name !== section.link && !name.startsWith(`${section.link}-`)) continue;
    if (!best || section.link.length > best.link.length) best = section;
  }
  if (best) return best.title;

  // A route outside the menu: its first word, capitalised.
  const first = name.split('-')[0]!;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
