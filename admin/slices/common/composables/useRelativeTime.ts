import { useTimeAgoIntl } from '@vueuse/core';
import { toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';

import { ADMIN_LOCALE, toDate, type Instant } from '../utils/format';

/**
 * `5 minutes ago`, live, in English whatever the browser says.
 *
 * The relative-time half of the admin format module. It lives apart from
 * `utils/format.ts` so that file stays free of Vue: pure utilities import it
 * and are tested without a component around them.
 *
 * Falls back to "now" for a missing date, as the components did before; they
 * decide themselves what to show when there is no date.
 */
export function useRelativeTime(source: MaybeRefOrGetter<Instant>): ComputedRef<string> {
  return useTimeAgoIntl(() => toDate(toValue(source)) ?? new Date(), {
    locale: ADMIN_LOCALE,
  });
}
