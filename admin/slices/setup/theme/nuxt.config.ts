import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import tailwindcss from '@tailwindcss/vite';

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(currentDir, '../../..');

// Read theme name from components.json
const componentsJson = JSON.parse(
  readFileSync(resolve(appRoot, 'components.json'), 'utf-8'),
);
const themeName = componentsJson.tailwind?.theme || 'default';
const themeCss = `#theme/assets/themes/${themeName}.css`;

export default defineNuxtConfig({
  modules: ['shadcn-nuxt'],
  css: [themeCss, '#theme/assets/css/tailwind.css'],
  alias: {
    '#theme': currentDir,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  shadcn: {
    prefix: '',
    componentDir: './slices/setup/theme/components/ui',
  },
  components: {
    dirs: [],
  },
});
