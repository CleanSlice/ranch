import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerSlices } from './registerSlices';

// In Docker builds RANCH_VERSION is set via --build-arg. In local `ranch dev`
// it isn't, so fall back to the root package.json version.
function rootRanchVersion(): string {
  if (process.env.RANCH_VERSION) return process.env.RANCH_VERSION;
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'dev';
  } catch {
    return 'dev';
  }
}

export default defineNuxtConfig({
  devtools: { enabled: false },
  extends: [...registerSlices()],
  ssr: false,
  future: {
    compatibilityVersion: 4,
  },
  runtimeConfig: {
    public: {
      ranchVersion: rootRanchVersion(),
      // Which error-tracking project this console reports to (CLEAN-218).
      // The destination itself is `sentryDsn`, in the `setup/sentry` slice.
      sentryProject: 'app',
      // Prod (k8s) sets NUXT_PUBLIC_API_URL, which Nuxt's runtimeConfig env
      // override picks up automatically. Local `ranch dev` only sets plain
      // API_URL (see app/.env) — without this fallback, apiUrl stays ''
      // and the axios client resolves requests against its own origin
      // instead of the api.
      apiUrl: process.env.API_URL || '',
      // Where this console is published, when that is not the host it is
      // reached on — share links carry it. Normally left empty: the share
      // slice falls back to the address bar, which is right almost
      // everywhere. Set NUXT_PUBLIC_APP_URL for an install that answers on
      // more than one hostname (CLEAN-110). Same variable the admin console
      // reads, so one value configures both (CLEAN-111).
      appUrl: process.env.APP_URL || '',
      // Which approved RANCH logo the landing shows: `orbit` (the copper
      // R-bubble lockup, the default) or `agent-hub` (the SVG arch mark). Set
      // NUXT_PUBLIC_BRAND_VARIANT; `?brand=agent-hub` previews the other one.
      brandVariant: process.env.NUXT_PUBLIC_BRAND_VARIANT || 'orbit',
    },
  },
  app: {
    head: {
      // The console, the landing and the gate are all dark. This is an SPA
      // (`ssr: false`): the shell the server sends is painted before any of
      // our JavaScript runs, and without the class it was painted in the
      // light theme, white, and then flipped to dark when the layout mounted.
      // The class puts the dark tokens in force from the first byte; the
      // inline background covers the moment before the stylesheets arrive.
      htmlAttrs: {
        class: 'dark',
        style: 'background-color:#0c0910;color-scheme:dark',
      },
      meta: [
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#0c0910' },
      ],
      // The orbit mark as a .ico (owner's file, CLEAN-215); one 256px entry,
      // which every browser scales down itself.
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
    },
  },
  routeRules: {
    '/**': { headers: { 'Cache-Control': 'no-cache' } },
    '/_nuxt/**': {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    },
  },
  vite: {
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
  },
  modules: ['@nuxt/image'],
  compatibilityDate: '2026-08-14',
});
