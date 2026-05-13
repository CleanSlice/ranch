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
  runtimeConfig: {
    public: {
      ranchVersion: rootRanchVersion(),
    },
  },
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
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
  compatibilityDate: '2024-10-04',
});
