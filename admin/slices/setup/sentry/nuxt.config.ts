import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

// Error tracking (CLEAN-218). This directory is identical in `admin` and
// `app`, file for file; `scripts/sentry-twin.test.ts` keeps it that way.
export default defineNuxtConfig({
  alias: {
    // Same alias as main-site. Not `#sentry`: `@sentry/nuxt` reserves that
    // one, should it ever be added.
    '#app-sentry': currentDir,
  },
  runtimeConfig: {
    public: {
      // Where this console reports. Empty means reporting is off, which is
      // the state of every build that has not set NUXT_PUBLIC_SENTRY_DSN.
      // Public by necessity — the browser is what sends — and an ingest
      // address, not a credential: it cannot read anything.
      sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN ?? '',
    },
  },
});
