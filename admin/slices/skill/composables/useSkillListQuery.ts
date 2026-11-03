import { isSkillGroup } from '#skill/domain/skill.groups';
import type { GroupFilter } from '#skill/utils/filterSkills';

export type SkillSort = 'custom' | 'recent';

/**
 * The Skills page's addressable state lives in the URL and nowhere else
 * (CLEAN-205): `?q=&group=&sort=&skill=`. Search, group and sort are written
 * with `replace` — typing must not fill the history. Picking a skill from
 * nothing is a `push`, so Back closes the drawer or the sheet; picking
 * another skill while one is open is a `replace`, so Back still closes
 * rather than walking through every row the admin looked at. Defaults are
 * omitted so the address bar says only what differs from a fresh page.
 */
export function useSkillListQuery() {
  const route = useRoute();
  const router = useRouter();

  const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
  const group = computed<GroupFilter>(() => {
    const g = route.query.group;
    return g === 'none' || isSkillGroup(g) ? g : 'all';
  });
  const sort = computed<SkillSort>(() => (route.query.sort === 'recent' ? 'recent' : 'custom'));
  const selectedSlug = computed(() =>
    typeof route.query.skill === 'string' && route.query.skill ? route.query.skill : null,
  );

  // True while the current `?skill` entry is one this page pushed, so
  // `clearSelection` can pop it and leave the history as it found it.
  let pushedSelection = false;
  watch(selectedSlug, (slug) => {
    if (!slug) pushedSelection = false;
  });

  function patch(next: Record<string, string | undefined>, mode: 'replace' | 'push' = 'replace') {
    const query = { ...route.query, ...next };
    for (const key of Object.keys(query)) if (query[key] === undefined) delete query[key];
    return mode === 'push' ? router.push({ query }) : router.replace({ query });
  }

  function setQ(value: string) {
    if (value === q.value) return;
    void patch({ q: value || undefined });
  }

  function setGroup(value: GroupFilter) {
    if (value === group.value) return;
    void patch({ group: value === 'all' ? undefined : value });
  }

  function setSort(value: SkillSort) {
    if (value === sort.value) return;
    void patch({ sort: value === 'custom' ? undefined : value });
  }

  function select(slug: string) {
    if (slug === selectedSlug.value) return;
    if (selectedSlug.value === null) {
      pushedSelection = true;
      void patch({ skill: slug }, 'push');
    } else {
      void patch({ skill: slug });
    }
  }

  /** Close the panel: Back if we opened it, otherwise rewrite the address. */
  function clearSelection() {
    if (selectedSlug.value === null) return;
    if (pushedSelection) {
      pushedSelection = false;
      router.back();
    } else {
      void patch({ skill: undefined });
    }
  }

  /** Point the address at another skill (or none) without touching history. */
  function replaceSelection(slug: string | null) {
    void patch({ skill: slug ?? undefined });
  }

  function clearFilters() {
    void patch({ q: undefined, group: undefined });
  }

  return {
    q,
    group,
    sort,
    selectedSlug,
    setQ,
    setGroup,
    setSort,
    select,
    clearSelection,
    replaceSelection,
    clearFilters,
  };
}
