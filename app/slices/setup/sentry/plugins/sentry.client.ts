import { useAuthStore } from '#auth/stores/auth';
import { initSentry, setSentryScreen, setSentryUser } from '../sentry.client';
import { readReportingConfig } from '../sentry.config';
import { isReportingEnabled } from '../sentry.rules';

export default defineNuxtPlugin({
  name: 'sentry',
  setup() {
    const config = readReportingConfig(
      useRuntimeConfig().public,
      window.location.hostname,
      import.meta.dev,
    );
    // Off in dev and wherever no destination is set: nothing below runs and
    // the SDK is never downloaded.
    if (!isReportingEnabled(config)) return;

    void initSentry(config);

    // Which screen broke — the route pattern, so no id or token rides along.
    const router = useRouter();
    const label = (route: { matched: { path: string }[] }) =>
      setSentryScreen(route.matched.at(-1)?.path ?? 'unmatched');
    label(router.currentRoute.value);
    router.afterEach(label);

    // Who it broke for — the id only, cleared on sign-out.
    const auth = useAuthStore();
    watch(
      () => auth.user?.id ?? null,
      (id) => setSentryUser(id),
      { immediate: true },
    );
  },
});
