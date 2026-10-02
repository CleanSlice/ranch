/**
 * The handshake between the top bar and `PageBreadcrumbs` (CLEAN-135).
 *
 * The bar has one title slot. A page that renders breadcrumbs moves them
 * into it; a page that does not leaves the bar to show the section's name.
 * This counter is how the bar knows which case it is in: breadcrumbs count
 * themselves in when they land in the bar and out when they leave.
 */
export const PAGE_TITLE_TARGET_ID = 'page-title';

export function usePageCrumbs() {
  return useState<number>('admin-page-crumbs', () => 0);
}
