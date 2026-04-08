import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', 'shadcn-nuxt'],
  alias: {
    '#theme': currentDir,
  },
  tailwindcss: {
    cssPath: '#theme/assets/css/tailwind.css',
  },
  shadcn: {
    prefix: '',
    componentDir: './slices/setup/theme/components/ui',
  },
});
