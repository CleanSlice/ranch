import { useMediaQuery } from '@vueuse/core';

/**
 * Which host the skill panel gets (CLEAN-205): a sticky column from 1280 px,
 * a right drawer from 768 px, a bottom sheet below. The two widths are
 * Tailwind's `xl` and `md`, so the classes in the templates and this
 * composable agree without configuration. SSR renders the desktop layout;
 * the media queries correct it on hydration.
 */
export type SkillLayout = 'desktop' | 'tablet' | 'phone';

export function useSkillLayout() {
  const xl = useMediaQuery('(min-width: 1280px)', { ssrWidth: 1280 });
  const md = useMediaQuery('(min-width: 768px)', { ssrWidth: 1280 });
  const layout = computed<SkillLayout>(() =>
    xl.value ? 'desktop' : md.value ? 'tablet' : 'phone',
  );
  return {
    layout,
    isDesktop: computed(() => layout.value === 'desktop'),
    isPhone: computed(() => layout.value === 'phone'),
  };
}
